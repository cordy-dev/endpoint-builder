import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { AbortError, type ApiError, createApi,createClient, defineContract, endpoint, HttpError, SizeLimitError } from "../src";
import { chunked, json, mockFetch, sseResponse } from "./helpers";

const base = "https://api.test";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe("idempotent()", () => {
	it("sends one key for all attempts and retries a POST", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({}, { status: 503 }), json({ ok: true }));
		const api = createClient({ baseUrl: base, fetch, retry: { delay: 0 } });
		expect(await api.post("/payments", { json: { amount: 1 } }).idempotent()).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledTimes(3);
		const keys = fetch.calls.map(call => call.headers.get("idempotency-key"));
		expect(keys[0]).toMatch(/^[0-9a-f-]{16,}$/);
		expect(new Set(keys).size).toBe(1);
	});

	it("accepts your own key and header name, and keeps a header you set yourself", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: base, fetch });
		await api.post("/a").idempotent("order-42");
		await api.post("/b").idempotent({ key: "k", header: "X-Idempotency-Key" });
		await api.post("/c").header("Idempotency-Key", "mine").idempotent();
		expect(fetch.calls[0]!.headers.get("idempotency-key")).toBe("order-42");
		expect(fetch.calls[1]!.headers.get("x-idempotency-key")).toBe("k");
		expect(fetch.calls[2]!.headers.get("idempotency-key")).toBe("mine");
	});

	it("generates a fresh key per request", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: base, fetch });
		const request = api.post("/a").idempotent();
		await request;
		await request;
		expect(fetch.calls[0]!.headers.get("idempotency-key")).not.toBe(fetch.calls[1]!.headers.get("idempotency-key"));
	});

	it("without it a POST is neither retried nor given a key", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({}));
		const api = createClient({ baseUrl: base, fetch, retry: { delay: 0 } });
		await api.post("/a").safe();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.calls[0]!.headers.has("idempotency-key")).toBe(false);
	});

	it("still sends the key when retries are disabled, and does not widen other methods", async () => {
		const fetch = mockFetch(json({}, { status: 503 }));
		const api = createClient({ baseUrl: base, fetch, retry: false });
		await api.patch("/a").idempotent().safe();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch.calls[0]!.headers.has("idempotency-key")).toBe(true);
	});

	it("a contract endpoint creates a new key for every call, shared only by that call's retries", async () => {
		const contract = defineContract({ pay: endpoint.post("/pay").idempotent().as<unknown>() });
		const fetch = mockFetch(json({}, { status: 503 }), json({}), json({}));
		const api = createApi(contract, { baseUrl: base, fetch, retry: { delay: 0 } });
		await api.pay();
		await api.pay();
		const [first, retried, second] = fetch.calls.map(call => call.headers.get("idempotency-key"));
		expect(first).toBe(retried);
		expect(second).not.toBe(first);
	});

	it("works in contracts", async () => {
		const contract = defineContract({ pay: endpoint.post("/pay").idempotent().as<{ ok: true }>() });
		const fetch = mockFetch(json({}, { status: 502 }), json({ ok: true }));
		const api = createApi(contract, { baseUrl: base, fetch, retry: { delay: 0 } });
		expect(await api.pay()).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.calls[0]!.headers.get("idempotency-key")).toBe(fetch.calls[1]!.headers.get("idempotency-key"));
	});
});

describe("concurrency & rateLimit", () => {
	function slowFetch(ms: number) {
		let active = 0;
		let peak = 0;
		const fn = mockFetch(async () => {
			peak = Math.max(peak, ++active);
			await sleep(ms);
			active--;
			return json({});
		});
		return Object.assign(fn, { peak: () => peak });
	}

	it("caps the number of simultaneous requests and queues the rest in order", async () => {
		const fetch = slowFetch(20);
		const api = createClient({ baseUrl: base, fetch, concurrency: 2 });
		await Promise.all(Array.from({ length: 6 }, (_, i) => api.get(`/${i}`)));
		expect(fetch.peak()).toBe(2);
		expect(fetch.calls.map(c => c.url.slice(-1))).toEqual(["0", "1", "2", "3", "4", "5"]);
	});

	it("limits the start rate with a sliding window", async () => {
		const starts: number[] = [];
		const fetch = mockFetch(() => { starts.push(Date.now()); return json({}); });
		const api = createClient({ baseUrl: base, fetch, rateLimit: { requests: 2, per: 100 } });
		const began = Date.now();
		await Promise.all(Array.from({ length: 5 }, (_, i) => api.get(`/${i}`)));
		const offsets = starts.map(t => t - began);
		expect(offsets[1]!).toBeLessThan(50); // two fit into the first window
		expect(offsets[2]!).toBeGreaterThanOrEqual(90); // the third waits for the window to slide
		expect(offsets[4]!).toBeGreaterThanOrEqual(190);
	});

	it("counts retries too, so a retry storm cannot exceed the limit", async () => {
		const starts: number[] = [];
		const fetch = mockFetch(() => { starts.push(Date.now()); return starts.length === 1 ? json({}, { status: 503 }) : json({ ok: true }); });
		const api = createClient({ baseUrl: base, fetch, retry: { delay: 0 }, rateLimit: { requests: 1, per: 80 } });
		await api.get("/x");
		expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(70);
	});

	it("a request that is aborted while queued never reaches the network", async () => {
		const fetch = slowFetch(60);
		const api = createClient({ baseUrl: base, fetch, concurrency: 1 });
		const first = api.get("/first").send(); // builders are lazy: send() actually starts the request
		const controller = new AbortController();
		const queued = api.get("/second").signal(controller.signal).safe();
		setTimeout(() => controller.abort(), 10);
		expect((await queued).error).toBeInstanceOf(AbortError);
		await first;
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("frees the slot when a request fails", async () => {
		const fetch = mockFetch(() => { throw new TypeError("down"); });
		const api = createClient({ baseUrl: base, fetch, retry: false, concurrency: 1 });
		for (let i = 0; i < 3; i++) await api.get("/x").safe();
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("is shared by derived clients unless the limits change", async () => {
		const fetch = slowFetch(20);
		const root = createClient({ baseUrl: base, fetch, concurrency: 1 });
		const sibling = root.with({ headers: { "x-a": "1" } });
		await Promise.all([root.get("/a"), sibling.get("/b"), sibling.get("/c")]);
		expect(fetch.peak()).toBe(1);

		const wider = root.with({ concurrency: 3 });
		await Promise.all([wider.get("/a"), wider.get("/b"), wider.get("/c")]);
		expect(fetch.peak()).toBe(3);
	});

	it("rejects invalid limits", () => {
		expect(() => createClient({ concurrency: 0 })).toThrow(RangeError);
		expect(() => createClient({ rateLimit: { requests: 0, per: 1000 } })).toThrow(RangeError);
		expect(() => createClient({ rateLimit: { requests: 1, per: 0 } })).toThrow(RangeError);
	});
});

describe("maxResponseBytes", () => {
	it("rejects a body announced as too large without reading it", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel });
		const fetch = () => Promise.resolve(new Response(body, { headers: { "content-type": "application/json", "content-length": "5000" } }));
		const api = createClient({ baseUrl: base, fetch, maxResponseBytes: 1000 });
		const { error } = await api.get("/big").safe();
		expect(error).toBeInstanceOf(SizeLimitError);
		expect(error).toMatchObject({ type: "size", limit: 1000, declared: 5000 });
		expect(error!.message).toBe("Response body exceeds 1000 bytes (Content-Length: 5000) (GET https://api.test/big)");
		expect(cancel).toHaveBeenCalled();
	});

	it("stops reading an endless chunked body as soon as the limit is exceeded", async () => {
		let sent = 0;
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { sent += 100; controller.enqueue(new Uint8Array(100).fill(65)); },
			cancel,
		});
		const fetch = () => Promise.resolve(new Response(body, { headers: { "content-type": "text/plain" } }));
		const api = createClient({ baseUrl: base, fetch, maxResponseBytes: 1000 });
		const { error } = await api.get("/endless").safe();
		expect(error).toBeInstanceOf(SizeLimitError);
		expect(sent).toBeLessThan(5000);
		expect(cancel).toHaveBeenCalled();
	});

	it("passes bodies under the limit through every decoder", async () => {
		const payload = JSON.stringify({ a: "ü".repeat(10) });
		const bytes = new TextEncoder().encode(payload).length;
		const make = () => new Response(payload, { headers: { "content-type": "application/json" } });
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => make()), maxResponseBytes: bytes });
		expect(await api.get("/x")).toEqual({ a: "ü".repeat(10) });
		expect(await api.get("/x").text()).toBe(payload);
		expect((await api.get("/x").blob()).size).toBe(bytes);
		expect((await api.get("/x").arrayBuffer()).byteLength).toBe(bytes);
		const tight = createClient({ baseUrl: base, fetch: mockFetch(() => make()), maxResponseBytes: bytes - 1 });
		expect((await tight.get("/x").safe()).error).toBeInstanceOf(SizeLimitError);
	});

	it("can be set per request and lifted with false", async () => {
		const fetch = mockFetch(() => new Response("x".repeat(500), { headers: { "content-type": "text/plain" } }));
		const api = createClient({ baseUrl: base, fetch, maxResponseBytes: 100 });
		expect((await api.get("/x").safe()).error).toBeInstanceOf(SizeLimitError);
		expect(await api.get("/x").maxResponseBytes(false)).toHaveLength(500);
		expect(await createClient({ baseUrl: base, fetch }).get("/x").maxResponseBytes(1000)).toHaveLength(500);
		expect((await createClient({ baseUrl: base, fetch }).get("/x").maxResponseBytes(10).safe()).error).toBeInstanceOf(SizeLimitError);
	});

	it("truncates, but does not reject, huge error bodies", async () => {
		const fetch = mockFetch(() => new Response("e".repeat(5000), { status: 500, headers: { "content-type": "text/plain" } }));
		const api = createClient({ baseUrl: base, fetch, retry: false, maxResponseBytes: 100 });
		const { error } = await api.get("/x").safe();
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).body).toBe("e".repeat(100));
	});

	it("does not apply to streams, and empty bodies are fine", async () => {
		const events = Array.from({ length: 50 }, (_, i) => `data: {"n":${i}}\n\n`);
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(events)), maxResponseBytes: 50 });
		expect(await (await api.get("/x").sse()).toArray()).toHaveLength(50);

		const empty = createClient({ baseUrl: base, fetch: mockFetch(new Response(null, { status: 204 })), maxResponseBytes: 1 });
		expect(await empty.delete("/x")).toBeUndefined();
	});

	it("is part of the error union", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => chunked(["x".repeat(10)])), maxResponseBytes: 5 });
		const { error } = await api.get("/x").safe();
		expectTypeOf(error).toEqualTypeOf<ApiError | undefined>();
		if (error?.type === "size") expectTypeOf(error).toEqualTypeOf<SizeLimitError>();
		expect(error?.type).toBe("size");
	});
});
