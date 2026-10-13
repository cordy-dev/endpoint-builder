import { describe, expect, it, vi } from "vitest";

import { AbortError, computeDelay, createClient, HttpError, NetworkError, type RequestContext, TimeoutError } from "../src";
import { hangingFetch, json, mockFetch } from "./helpers";

const fast = { delay: 0, jitter: false } as const;

describe("retry", () => {
	it("retries idempotent requests on retryable statuses", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({}, { status: 502 }), json({ ok: true }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: fast });
		expect(await api.get("/")).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it("does not retry POST by default", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({ ok: true }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: fast });
		await expect(api.post("/")).rejects.toBeInstanceOf(HttpError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("retries POST when allowed explicitly", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({ ok: true }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: fast });
		expect(await api.post("/").retry({ methods: ["POST"] })).toEqual({ ok: true });
	});

	it("retries network errors (they were silently dropped in 1.x)", async () => {
		let calls = 0;
		const fetch = mockFetch(() => {
			if (++calls < 3) throw new TypeError("fetch failed");
			return json({ ok: true });
		});
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: fast });
		expect(await api.get("/")).toEqual({ ok: true });
		expect(calls).toBe(3);
	});

	it("respects the limit and surfaces the last error", async () => {
		const fetch = mockFetch(json({}, { status: 500 }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: { ...fast, limit: 3 } });
		const { error } = await api.get("/").safe();
		expect(error).toBeInstanceOf(HttpError);
		expect(fetch).toHaveBeenCalledTimes(4);
	});

	it("never retries non-retryable statuses", async () => {
		const fetch = mockFetch(json({}, { status: 400 }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: fast });
		await expect(api.get("/")).rejects.toBeInstanceOf(HttpError);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("can be disabled per request and globally", async () => {
		const fetch = mockFetch(json({}, { status: 503 }));
		await createClient({ baseUrl: "https://api.test", fetch, retry: fast }).get("/").retry(false).safe();
		await createClient({ baseUrl: "https://api.test", fetch, retry: false }).get("/").safe();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("supports custom decisions and onRetry hooks", async () => {
		const fetch = mockFetch(json({}, { status: 409 }), json({ ok: true }));
		const onRetry = vi.fn();
		const api = createClient({
			baseUrl: "https://api.test",
			fetch,
			onRetry,
			retry: { ...fast, shouldRetry: ({ response }) => response?.status === 409 ? true : undefined },
		});
		expect(await api.get("/")).toEqual({ ok: true });
		expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, delay: 0 }));
	});

	it("honours Retry-After and gives up when it is too long", () => {
		const response = (value: string) => new Response(null, { status: 429, headers: { "retry-after": value } });
		const request = {} as RequestContext;
		expect(computeDelay({}, { attempt: 1, request, response: response("2") })).toBe(2000);
		expect(computeDelay({ retryAfter: 1000 }, { attempt: 1, request, response: response("2") })).toBeUndefined();
		expect(computeDelay({ retryAfter: false, delay: 100, jitter: false }, { attempt: 3, request, response: response("2") })).toBe(400);
	});

	it("computes backoff variants", () => {
		const request = {} as RequestContext;
		const state = { attempt: 3, request };
		expect(computeDelay({ delay: 100, jitter: false }, state)).toBe(400);
		expect(computeDelay({ delay: 100, jitter: false, backoff: "linear" }, state)).toBe(300);
		expect(computeDelay({ delay: 100, jitter: false, backoff: "constant" }, state)).toBe(100);
		expect(computeDelay({ delay: 100, jitter: false, maxDelay: 250 }, state)).toBe(250);
		const jittered = computeDelay({ delay: 100 }, state)!;
		expect(jittered).toBeGreaterThanOrEqual(200);
		expect(jittered).toBeLessThanOrEqual(400);
	});

	it("aborting during the backoff stops immediately", async () => {
		const fetch = mockFetch(json({}, { status: 503 }));
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: { delay: 10_000, jitter: false } });
		const controller = new AbortController();
		const pending = api.get("/").signal(controller.signal).safe();
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
		controller.abort();
		expect((await pending).error).toBeInstanceOf(AbortError);
	});
});

describe("timeout & abort", () => {
	it("applies the timeout (it was ignored in 1.x)", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: hangingFetch(), retry: false });
		const { error } = await api.get("/").timeout(20).safe();
		expect(error).toBeInstanceOf(TimeoutError);
		expect((error as TimeoutError).timeout).toBe(20);
	});

	it("retries timeouts", async () => {
		let calls = 0;
		const slow = hangingFetch();
		const fetch = vi.fn((url: string, init: RequestInit) => ++calls === 1 ? slow(url, init) : Promise.resolve(json({ ok: true })));
		const api = createClient({ baseUrl: "https://api.test", fetch, timeout: 20, retry: fast });
		expect(await api.get("/")).toEqual({ ok: true });
	});

	it("covers slow bodies, not only headers", async () => {
		const fetch = vi.fn((_url: string, init: RequestInit) => {
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("{\"a\":"));
					init.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
				},
			});
			return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }));
		});
		const api = createClient({ baseUrl: "https://api.test", fetch, timeout: 20, retry: false });
		expect((await api.get("/").safe()).error).toBeInstanceOf(TimeoutError);
	});

	it("passes user abort signals through (they were ignored in 1.x)", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: hangingFetch(), timeout: false });
		const controller = new AbortController();
		const pending = api.get("/").signal(controller.signal).safe();
		controller.abort("user");
		const { error } = await pending;
		expect(error).toBeInstanceOf(AbortError);
		expect((error as AbortError).cause).toBe("user");
	});

	it("fails fast with an already-aborted signal", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		const { error } = await api.get("/").signal(AbortSignal.abort()).safe();
		expect(error).toBeInstanceOf(AbortError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("does not keep timers alive after success", async () => {
		vi.useFakeTimers();
		try {
			const api = createClient({ baseUrl: "https://api.test", fetch: mockFetch(json({ a: 1 })), timeout: 1000 });
			await api.get("/");
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("dedupe", () => {
	it("shares one call between identical concurrent GETs", async () => {
		const fetch = mockFetch(async () => {
			await new Promise(r => setTimeout(r, 10));
			return json({ n: 1 });
		});
		const api = createClient({ baseUrl: "https://api.test", fetch, dedupe: true });
		const [a, b] = await Promise.all([api.get("/x"), api.get("/x")]);
		expect(a).toEqual({ n: 1 });
		expect(b).toEqual({ n: 1 });
		expect(a).not.toBe(b);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("never dedupes POST, different headers or different queries", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: "https://api.test", fetch, dedupe: true });
		await Promise.all([
			api.post("/x", { json: { a: 1 } }),
			api.post("/x", { json: { a: 2 } }),
			api.get("/x").header("x-user", "1"),
			api.get("/x").header("x-user", "2"),
			api.get("/x", { query: { q: 1 } }),
		]);
		expect(fetch).toHaveBeenCalledTimes(5);
	});

	it("one caller aborting does not cancel the others", async () => {
		const fetch = mockFetch(async () => {
			await new Promise(r => setTimeout(r, 20));
			return json({ ok: true });
		});
		const api = createClient({ baseUrl: "https://api.test", fetch, dedupe: true });
		const controller = new AbortController();
		const first = api.get("/x").signal(controller.signal).safe();
		const second = api.get("/x").safe();
		controller.abort();
		expect((await first).error).toBeInstanceOf(AbortError);
		expect((await second).data).toEqual({ ok: true });
	});
});

describe("transport", () => {
	it("NetworkError message includes method and URL", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: () => Promise.reject(new TypeError("ECONNREFUSED")), retry: false });
		const { error } = await api.get("/x").safe();
		expect(error).toBeInstanceOf(NetworkError);
		expect(error!.message).toContain("GET https://api.test/x");
	});
});
