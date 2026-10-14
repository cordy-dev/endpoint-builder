import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import { AbortError, createClient, defineContract, endpoint, type EventStream, HttpError, NetworkError, ParseError, SizeLimitError, type SseMessage, TimeoutError, ValidationError } from "../src";
import { chunked, hangingFetch, json, mockFetch, ndjsonResponse, sseResponse } from "./helpers";

const Chat = z.object({ type: z.string(), text: z.string().optional() });
const base = "https://api.test";
const sse = (...events: string[]) => sseResponse(events.map(e => `${e}\n\n`));

describe("sse", () => {
	it("yields validated JSON payloads", async () => {
		const fetch = mockFetch(() => sse("data: {\"type\":\"delta\",\"text\":\"Hel\"}", "event: done\ndata: {\"type\":\"done\"}"));
		const api = createClient({ baseUrl: base, fetch });
		const stream = await api.get("/chat").sse(Chat);
		expectTypeOf(stream).toEqualTypeOf<EventStream<{ type: string; text?: string | undefined }>>();
		expect(await stream.toArray()).toEqual([{ type: "delta", text: "Hel" }, { type: "done" }]);
		expect(fetch.calls[0]!.headers.get("accept")).toBe("text/event-stream");
	});

	it("without a schema yields raw messages with event, id and multi-line data", async () => {
		const api = createClient({
			baseUrl: base,
			fetch: mockFetch(() => sseResponse([": keep-alive\n\n", "id: 7\nevent: tick\ndata: a\ndata: b\n\n", "data: c\n\n"])),
		});
		const stream = await api.get("/ticks").sse();
		expectTypeOf(stream).toEqualTypeOf<EventStream<SseMessage>>();
		expect(await stream.toArray()).toEqual([
			{ event: "tick", data: "a\nb", id: "7", retry: undefined },
			{ event: "message", data: "c", id: "7", retry: undefined },
		]);
	});

	it("parses CRLF / CR line endings and chunk boundaries inside lines, \\r\\n pairs and UTF-8 characters", async () => {
		const bytes = new TextEncoder().encode("data: {\"type\":\"ünï\"}\r\n\r\ndata: {\"type\":\"b\"}\r\r");
		const chunks = [...bytes].map(byte => new Uint8Array([byte])); // one byte per chunk
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(chunks)) });
		expect(await (await api.get("/x").sse(Chat)).toArray()).toEqual([{ type: "ünï" }, { type: "b" }]);
	});

	it("drops an unterminated trailing event and strips a BOM", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(["﻿data: {\"type\":\"a\"}\n\n", "data: {\"type\":\"cut\"}"])) });
		expect(await (await api.get("/x").sse(Chat)).toArray()).toEqual([{ type: "a" }]);
	});

	it("stops on a sentinel", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sse("data: {\"type\":\"a\"}", "data: [DONE]", "data: {\"type\":\"never\"}")) });
		expect(await (await api.get("/x").sse(Chat, { stopOn: "[DONE]" })).toArray()).toEqual([{ type: "a" }]);
		const byFn = createClient({ baseUrl: base, fetch: mockFetch(() => sse("data: {\"type\":\"a\"}", "event: end\ndata: {}", "data: {\"type\":\"never\"}")) });
		expect(await (await byFn.get("/x").sse(Chat, { stopOn: m => m.event === "end" })).toArray()).toEqual([{ type: "a" }]);
	});

	it("ends the stream with ValidationError / ParseError by default", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sse("data: {\"type\":\"a\"}", "data: {\"type\":1}", "data: {\"type\":\"c\"}")) });
		const seen: unknown[] = [];
		const error = await (async () => {
			try {
				for await (const event of await api.get("/x").sse(Chat)) seen.push(event);
			} catch (e) {
				return e;
			}
		})();
		expect(seen).toEqual([{ type: "a" }]);
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).stage).toBe("response");

		const bad = createClient({ baseUrl: base, fetch: mockFetch(() => sse("data: not json")) });
		await expect((await bad.get("/x").sse(Chat)).toArray()).rejects.toBeInstanceOf(ParseError);
	});

	it("can skip invalid events instead", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sse("data: {\"type\":\"a\"}", "data: {\"type\":1}", "data: nope", "data: {\"type\":\"c\"}")) });
		expect(await (await api.get("/x").sse(Chat, { onInvalid: "skip" })).toArray()).toEqual([{ type: "a" }, { type: "c" }]);
	});

	it("fails before iterating when the status is not ok, with typed errors and safe()", async () => {
		const fetch = mockFetch(json({ message: "no" }, { status: 401 }));
		const api = createClient({ baseUrl: base, fetch, retry: false, errors: { 401: z.object({ message: z.string() }) } });
		const { data, error } = await api.get("/chat").sse(Chat).safe();
		expect(data).toBeUndefined();
		expect(error).toBeInstanceOf(HttpError);
		expect((error as HttpError).body).toEqual({ message: "no" });
	});

	it("breaking out of the loop closes the connection", async () => {
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { controller.enqueue(new TextEncoder().encode("data: {\"type\":\"tick\"}\n\n")); },
			cancel: cancelled,
		});
		const api = createClient({ baseUrl: base, fetch: () => Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } })) });
		let count = 0;
		for await (const _event of await api.get("/x").sse(Chat)) {
			if (++count === 3) break;
		}
		expect(cancelled).toHaveBeenCalledTimes(1);
	});

	it("cancel() closes a stream that was never iterated", async () => {
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
		const api = createClient({ baseUrl: base, fetch: () => Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } })) });
		await (await api.get("/x").sse(Chat)).cancel();
		expect(cancelled).toHaveBeenCalledTimes(1);
	});

	it("does not dedupe streams", async () => {
		const fetch = mockFetch(() => sse("data: {\"type\":\"a\"}"));
		const api = createClient({ baseUrl: base, fetch, dedupe: true });
		await Promise.all([api.get("/x").sse(Chat), api.get("/x").sse(Chat)]);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe("abort & timeout", () => {
	/** A stream that never ends but errors out when the fetch signal aborts, like undici does */
	function endlessFetch() {
		return vi.fn((_url: string, init: RequestInit) => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("data: {\"type\":\"first\"}\n\n"));
					init.signal?.addEventListener("abort", () => controller.error(init.signal!.reason ?? new DOMException("Aborted", "AbortError")));
				},
			});
			return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }));
		});
	}

	it("a user abort after the headers still cancels the stream, even with the default timeout", async () => {
		const api = createClient({ baseUrl: base, fetch: endlessFetch(), retry: false }); // default 30s timeout
		const controller = new AbortController();
		const stream = await api.get("/x").signal(controller.signal).sse(Chat);
		const received: unknown[] = [];
		const error = await (async () => {
			try {
				for await (const event of stream) {
					received.push(event);
					controller.abort("stop");
				}
			} catch (e) {
				return e;
			}
		})();
		expect(received).toEqual([{ type: "first" }]);
		expect(error).toBeInstanceOf(AbortError);
	});

	it("the timeout covers the wait for the response, not the lifetime of the stream", async () => {
		const events = Array.from({ length: 5 }, (_, i) => `data: {"type":"e${i}"}\n\n`);
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(events, 20)), timeout: 50, retry: false });
		expect(await (await api.get("/x").sse(Chat)).toArray()).toHaveLength(5); // takes ~100ms > 50ms
	});

	it("a hanging connection still times out before the response", async () => {
		const api = createClient({ baseUrl: base, fetch: hangingFetch(), timeout: 20, retry: false });
		expect((await api.get("/x").sse(Chat).safe()).error).toBeInstanceOf(TimeoutError);
	});

	it("a connection that drops mid-stream surfaces as NetworkError", async () => {
		const fetch = () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("data: {\"type\":\"a\"}\n\n"));
				controller.error(new TypeError("terminated"));
			},
		}), { headers: { "content-type": "text/event-stream" } }));
		const api = createClient({ baseUrl: base, fetch, retry: false });
		const stream = await api.get("/x").sse(Chat);
		await expect(stream.toArray()).rejects.toBeInstanceOf(NetworkError);
	});
});

describe("wrapping a stream in your own generator (README example)", () => {
	it("yield* forwards values and closes the connection when the consumer stops early", async () => {
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { controller.enqueue(new TextEncoder().encode("data: {\"type\":\"tick\"}\n\n")); },
			cancel: cancelled,
		});
		const api = createClient({ baseUrl: base, fetch: () => Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } })) });

		async function* events(signal?: AbortSignal) {
			const stream = await api.get("/x").signal(signal).sse(Chat);
			yield* stream;
		}

		let count = 0;
		for await (const _event of events()) {
			if (++count === 3) break;
		}
		expect(cancelled).toHaveBeenCalledTimes(1);
	});
});

describe("ndjson", () => {
	it("yields validated lines across chunk boundaries and skips blank lines", async () => {
		const fetch = mockFetch(() => ndjsonResponse(["{\"type\":\"a\"}\n\n{\"ty", "pe\":\"b\"}\n", "{\"type\":\"c\"}"]));
		const api = createClient({ baseUrl: base, fetch });
		const stream = await api.get("/export").ndjson(Chat);
		expect(await stream.toArray()).toEqual([{ type: "a" }, { type: "b" }, { type: "c" }]);
		expect(fetch.calls[0]!.headers.get("accept")).toBe("application/x-ndjson");
	});

	it("validates, throws or skips", async () => {
		const lines = () => ndjsonResponse(["{\"type\":\"a\"}\n{\"type\":2}\nnot json\n{\"type\":\"d\"}\n"]);
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => lines()) });
		await expect((await api.get("/x").ndjson(Chat)).toArray()).rejects.toBeInstanceOf(ValidationError);
		expect(await (await api.get("/x").ndjson(Chat, { onInvalid: "skip" })).toArray()).toEqual([{ type: "a" }, { type: "d" }]);
	});

	it("an empty body is an empty stream", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(new Response(null, { status: 200 })) });
		expect(await (await api.get("/x").ndjson(Chat)).toArray()).toEqual([]);
	});
});

describe("contract", () => {
	const contract = defineContract({
		chat: endpoint.get("/chat/:room").query(z.object({ q: z.string() })).sse(Chat, { stopOn: "[DONE]" }),
		export: endpoint.get("/export").ndjson(Chat),
		ticks: endpoint.get("/ticks").sse(),
	});

	it("binds streaming endpoints; calls resolve with an EventStream", async () => {
		const fetch = mockFetch(() => sse("data: {\"type\":\"a\"}", "data: [DONE]"));
		const api = createClient({ baseUrl: base, fetch }).api(contract);
		const stream = await api.chat({ params: { room: "r1" }, query: { q: "hi" } });
		expectTypeOf(stream).toEqualTypeOf<EventStream<{ type: string; text?: string | undefined }>>();
		expect(await stream.toArray()).toEqual([{ type: "a" }]);
		expect(fetch.calls[0]!.url).toBe("https://api.test/chat/r1?q=hi");

		expectTypeOf(await api.export()).toEqualTypeOf<EventStream<{ type: string; text?: string | undefined }>>();
		expectTypeOf(await api.ticks()).toEqualTypeOf<EventStream<SseMessage>>();
	});
});

describe("chunked helper", () => {
	it("is itself a valid streaming response", async () => {
		expect(await chunked(["a", "b"]).text()).toBe("ab");
	});
});

describe("maxBytes", () => {
	const event = (n: number) => `data: {"type":"e${n}"}\n\n`;
	const eventBytes = new TextEncoder().encode(event(0)).length;

	it("ends the stream with SizeLimitError, after yielding what arrived in time", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(Array.from({ length: 10 }, (_, i) => event(i)))) });
		const stream = await api.get("/x").sse(Chat, { maxBytes: eventBytes * 2 + 5 });
		const seen: unknown[] = [];
		const error = await (async () => {
			try {
				for await (const item of stream) seen.push(item);
			} catch (e) {
				return e;
			}
		})();
		expect(seen).toEqual([{ type: "e0" }, { type: "e1" }]);
		expect(error).toBeInstanceOf(SizeLimitError);
		expect(error).toMatchObject({ type: "size", limit: eventBytes * 2 + 5 });
	});

	it("bounds an endless line without a newline, and closes the connection", async () => {
		let sent = 0;
		const cancelled = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			pull(controller) { sent += 100; controller.enqueue(new Uint8Array(100).fill(120)); },
			cancel: cancelled,
		});
		const api = createClient({ baseUrl: base, fetch: () => Promise.resolve(new Response(body, { headers: { "content-type": "application/x-ndjson" } })) });
		const stream = await api.get("/x").ndjson(Chat, { maxBytes: 1000 });
		await expect(stream.toArray()).rejects.toBeInstanceOf(SizeLimitError);
		expect(sent).toBeLessThan(5000);
		expect(cancelled).toHaveBeenCalled();
	});

	it("is not triggered by a stream that stays within the limit, and works in contracts", async () => {
		const events = Array.from({ length: 3 }, (_, i) => event(i));
		const contract = defineContract({ feed: endpoint.get("/feed").sse(Chat, { maxBytes: eventBytes * 3 }) });
		const api = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(events)) }).api(contract);
		expect(await (await api.feed()).toArray()).toHaveLength(3); // exactly at the limit
		const tight = createClient({ baseUrl: base, fetch: mockFetch(() => sseResponse(events)) }).api(defineContract({ feed: endpoint.get("/feed").sse(Chat, { maxBytes: eventBytes * 3 - 1 }) }));
		await expect((await tight.feed()).toArray()).rejects.toBeInstanceOf(SizeLimitError);
	});

	it("the client-wide maxResponseBytes still does not apply to streams", async () => {
		const api = createClient({ baseUrl: base, maxResponseBytes: 10, fetch: mockFetch(() => sseResponse(Array.from({ length: 5 }, (_, i) => event(i)))) });
		expect(await (await api.get("/x").sse(Chat)).toArray()).toHaveLength(5);
	});
});
