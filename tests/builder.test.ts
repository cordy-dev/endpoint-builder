import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import { type ApiError, bearer, Client, ClientBuilder, createClient, type Middleware } from "../src";
import { json, mockFetch } from "./helpers";

const Unauthorized = z.object({ reason: z.string() });
const Problem = z.object({ title: z.string() });

describe("ClientBuilder", () => {
	it("builds a configured client fluently", async () => {
		const fetch = mockFetch(json({ ok: true }));
		const api = new ClientBuilder()
			.baseUrl("https://api.test")
			.header("X-App", "web")
			.query({ v: 2 })
			.timeout(5000)
			.auth(bearer("t"))
			.retry(false)
			.fetch(fetch)
			.build();

		await api.get("/x");
		const call = fetch.calls[0]!;
		expect(call.url).toBe("https://api.test/x?v=2");
		expect(call.headers.get("x-app")).toBe("web");
		expect(call.headers.get("authorization")).toBe("Bearer t");
		expect(api.config.timeout).toBe(5000);
	});

	it("is immutable", () => {
		const base = Client.builder("https://a.test");
		const withHeader = base.header("x", "1");
		expect(base.config.headers).toEqual({});
		expect(withHeader.config.headers).toEqual({ x: "1" });
		expect(base.config.baseUrl).toBe("https://a.test");
	});

	it("accumulates error types like Elysia", async () => {
		const fetch = mockFetch(json({ title: "bad" }, { status: 422 }));
		const api = Client.builder("https://api.test")
			.errors({ 401: Unauthorized })
			.errors({ 422: Problem })
			.fetch(fetch)
			.build();

		const { error } = await api.post("/x").safe();
		expectTypeOf(error).toEqualTypeOf<ApiError<{ 401: { reason: string }; 422: { title: string } }> | undefined>();
		expect(error?.type).toBe("http");
	});

	it("derives clients with with() without touching the parent", async () => {
		const fetch = mockFetch(json({}));
		const root = createClient({ baseUrl: "https://api.test", fetch, headers: { "x-root": "1" } });
		const admin = root.with({ headers: { "x-admin": "1" } });
		const v2 = root.with({ baseUrl: "https://api.test/v2", errors: { 401: Unauthorized } });

		await root.get("/a");
		await admin.get("/a");
		await v2.get("/a");
		expect(fetch.calls[0]!.headers.has("x-admin")).toBe(false);
		expect(fetch.calls[1]!.headers.get("x-admin")).toBe("1");
		expect(fetch.calls[1]!.headers.get("x-root")).toBe("1");
		expect(fetch.calls[2]!.url).toBe("https://api.test/v2/a");
		expectTypeOf(v2).toEqualTypeOf<Client<{ 401: { reason: string } }>>();
	});
});

describe("RequestBuilder", () => {
	it("is immutable and reusable", async () => {
		const fetch = mockFetch(json([]));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		const list = api.get("/users").header("x-list", "1");
		const page2 = list.query({ page: 2 });

		await list;
		await page2;
		await list;
		expect(fetch.calls.map(c => c.url)).toEqual([
			"https://api.test/users",
			"https://api.test/users?page=2",
			"https://api.test/users",
		]);
	});

	it("is lazy: nothing is sent until awaited", () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		void api.get("/never").header("x", "1");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("supports promise combinators", async () => {
		const fetch = mockFetch(json({ a: 1 }));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		const results = await Promise.all([api.get("/1"), api.get("/2")]);
		expect(results).toEqual([{ a: 1 }, { a: 1 }]);
		const finallySpy = vi.fn();
		await api.get("/3").finally(finallySpy);
		expect(finallySpy).toHaveBeenCalled();
	});

	it("validates query and json inline", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		const Body = z.object({ n: z.number().transform(n => n * 2) });
		await api.post("/x").json({ n: 2 }, Body).query({ q: "1" }, z.object({ q: z.coerce.number() }));
		expect(fetch.calls[0]!.url).toBe("https://api.test/x?q=1");
		expect(await new Response(fetch.calls[0]!.body).json()).toEqual({ n: 4 });
		// @ts-expect-error n must be a number
		void api.post("/x").json({ n: "2" }, Body);
	});

	it("as<T>() types without validating", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: mockFetch(json({ anything: true })) });
		const data = await api.get("/").as<{ id: number }>();
		expectTypeOf(data).toEqualTypeOf<{ id: number }>();
	});

	it("defaults to unknown data", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: mockFetch(json({})) });
		const data = await api.get("/");
		expectTypeOf(data).toBeUnknown();
	});
});

describe("middleware & hooks", () => {
	it("runs middleware in order around the request", async () => {
		const fetch = mockFetch(json({ ok: true }));
		const order: string[] = [];
		const tag = (name: string): Middleware => async (ctx, next) => {
			order.push(`${name}:before`);
			ctx.headers.set(`x-${name}`, "1");
			const response = await next(ctx);
			order.push(`${name}:after`);
			return response;
		};
		const api = createClient({ baseUrl: "https://api.test", fetch, middleware: [tag("a"), tag("b")] });
		await api.get("/");
		expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
		expect(fetch.calls[0]!.headers.get("x-a")).toBe("1");
	});

	it("middleware can short-circuit (cache, mocks)", async () => {
		const fetch = mockFetch(json({ from: "network" }));
		const cache: Middleware = async (ctx, next) => ctx.url.endsWith("/cached") ? json({ from: "cache" }) : next(ctx);
		const api = Client.builder("https://api.test").fetch(fetch).use(cache).build();
		expect(await api.get("/cached")).toEqual({ from: "cache" });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("middleware sees request meta", async () => {
		const seen: unknown[] = [];
		const api = createClient({
			baseUrl: "https://api.test",
			fetch: mockFetch(json({})),
			middleware: [async (ctx, next) => { seen.push(ctx.meta.feature); return next(ctx); }],
		});
		await api.get("/").meta("feature", "search");
		expect(seen).toEqual(["search"]);
	});

	it("hooks observe requests, responses and errors", async () => {
		const fetch = mockFetch(json({ ok: true }), json({}, { status: 400 }));
		const onRequest = vi.fn((ctx: { headers: Headers }) => { ctx.headers.set("x-hook", "1"); });
		const onResponse = vi.fn();
		const onError = vi.fn();
		const api = createClient({ baseUrl: "https://api.test", fetch, onRequest, onResponse, onError, retry: false });
		await api.get("/ok");
		await api.get("/bad").safe();
		expect(fetch.calls[0]!.headers.get("x-hook")).toBe("1");
		expect(onResponse).toHaveBeenCalledTimes(2);
		expect(onError).toHaveBeenCalledTimes(1);
		expect(onError.mock.calls[0]![0].type).toBe("http");
	});

	it("onResponse can replace the response", async () => {
		const api = createClient({
			baseUrl: "https://api.test",
			fetch: mockFetch(json({ v: 1 })),
			onResponse: () => json({ v: 2 }),
		});
		expect(await api.get("/")).toEqual({ v: 2 });
	});
});
