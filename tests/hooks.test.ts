import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import { createClient, HttpError } from "../src";
import { json, mockFetch } from "./helpers";

const User = z.object({ id: z.number(), name: z.string() });
const base = "https://api.test";

describe("onSuccess", () => {
	it("receives the final data after validation and map()", async () => {
		const seen: unknown[] = [];
		const api = createClient({
			baseUrl: base,
			fetch: mockFetch(json({ id: 1, name: "ann" })),
			onSuccess: (data, response) => { seen.push(["client", data, response.status]); },
		});
		const name = await api.get("/u")
			.returns(User)
			.map(user => user.name.toUpperCase())
			.onSuccess((data) => {
				expectTypeOf(data).toEqualTypeOf<string>();
				seen.push(["request", data]);
			});
		expect(name).toBe("ANN");
		expect(seen).toEqual([["client", "ANN", 200], ["request", "ANN"]]);
	});

	it("is skipped on errors, and a throwing hook fails the request", async () => {
		const onSuccess = vi.fn();
		const api = createClient({ baseUrl: base, fetch: mockFetch(json({}, { status: 500 })), retry: false, onSuccess });
		await api.get("/u").safe();
		expect(onSuccess).not.toHaveBeenCalled();

		const ok = createClient({ baseUrl: base, fetch: mockFetch(json({})) });
		await expect(ok.get("/u").onSuccess(() => { throw new RangeError("hook bug"); })).rejects.toBeInstanceOf(RangeError);
	});
});

describe("request-level hooks", () => {
	it("run after the client hooks and see the same context", async () => {
		const fetch = mockFetch(json({ ok: true }));
		const order: string[] = [];
		const api = createClient({
			baseUrl: base,
			fetch,
			onRequest: (ctx) => { order.push("client:request"); ctx.headers.set("x-client", "1"); },
			onResponse: () => { order.push("client:response"); },
		});
		await api.get("/u")
			.onRequest((ctx) => { order.push("request:request"); ctx.headers.set("x-request", ctx.headers.get("x-client") ?? "missing"); })
			.onResponse((response) => { order.push(`request:response:${response.status}`); });
		expect(order).toEqual(["client:request", "request:request", "client:response", "request:response:200"]);
		expect(fetch.calls[0]!.headers.get("x-request")).toBe("1");
	});

	it("onResponse can replace the response", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(json({ v: 1 })) });
		expect(await api.get("/u").onResponse(() => json({ v: 2 }))).toEqual({ v: 2 });
	});

	it("onRetry runs per request and onRequest once per request, not per attempt", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({ ok: true }));
		const onRetry = vi.fn();
		const onRequest = vi.fn();
		const api = createClient({ baseUrl: base, fetch, retry: { delay: 0 } });
		await api.get("/u").onRetry(onRetry).onRequest(onRequest);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry.mock.calls[0]![0]).toMatchObject({ attempt: 1, delay: 0 });
		expect(onRequest).toHaveBeenCalledTimes(1);
	});

	it("onError runs after the client hook and can replace the error", async () => {
		const order: string[] = [];
		const api = createClient({
			baseUrl: base,
			fetch: mockFetch(json({}, { status: 404 })),
			retry: false,
			onError: (error) => { order.push(`client:${error.type}`); },
		});
		const result = await api.get("/u").onError((error) => {
			order.push(`request:${error.type}`);
			throw new Error("wrapped");
		}).safe().catch((e: unknown) => e);
		expect((result as Error).message).toBe("wrapped");
		expect(order).toEqual(["client:http", "request:http"]);

		const plain = await api.get("/u").safe();
		expect(plain.error).toBeInstanceOf(HttpError);
	});

	it("builders stay immutable: hooks do not leak to the parent", async () => {
		const fetch = mockFetch(json({}));
		const onRequest = vi.fn();
		const api = createClient({ baseUrl: base, fetch });
		const parent = api.get("/u");
		const child = parent.onRequest(onRequest);
		await parent;
		expect(onRequest).not.toHaveBeenCalled();
		await child;
		await child;
		expect(onRequest).toHaveBeenCalledTimes(2);
	});
});
