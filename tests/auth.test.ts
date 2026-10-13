import { describe, expect, it, vi } from "vitest";

import { apiKey, basic, bearer, createClient, HttpError, refreshable } from "../src";
import { json, mockFetch } from "./helpers";

const base = "https://api.test";

describe("auth strategies", () => {
	it("bearer accepts static and async tokens, skips empty ones", async () => {
		const fetch = mockFetch(json({}));
		await createClient({ baseUrl: base, fetch, auth: bearer("t1") }).get("/");
		await createClient({ baseUrl: base, fetch, auth: bearer(async () => "t2") }).get("/");
		await createClient({ baseUrl: base, fetch, auth: bearer(() => null) }).get("/");
		await createClient({ baseUrl: base, fetch, auth: "Bearer t3" }).get("/");
		expect(fetch.calls.map(c => c.headers.get("authorization"))).toEqual(["Bearer t1", "Bearer t2", null, "Bearer t3"]);
	});

	it("apiKey supports headers and query params without piling up on retries", async () => {
		const fetch = mockFetch(json({}, { status: 503 }), json({}));
		await createClient({ baseUrl: base, fetch, retry: { delay: 0 }, auth: apiKey("k", { query: "api_key" }) }).get("/x?a=1");
		expect(fetch.calls.map(c => c.url)).toEqual([`${base}/x?a=1&api_key=k`, `${base}/x?a=1&api_key=k`]);

		const headerFetch = mockFetch(json({}));
		await createClient({ baseUrl: base, fetch: headerFetch, auth: apiKey("k") }).get("/");
		expect(headerFetch.calls[0]!.headers.get("x-api-key")).toBe("k");
	});

	it("basic auth is UTF-8 safe", async () => {
		const fetch = mockFetch(json({}));
		await createClient({ baseUrl: base, fetch, auth: basic("юзер", "pässword") }).get("/");
		const header = fetch.calls[0]!.headers.get("authorization")!;
		const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), c => c.charCodeAt(0)));
		expect(decoded).toBe("юзер:pässword");
	});

	it("auth(false) sends an anonymous request", async () => {
		const fetch = mockFetch(json({}));
		await createClient({ baseUrl: base, fetch, auth: "t" }).get("/public").auth(false);
		expect(fetch.calls[0]!.headers.has("authorization")).toBe(false);
	});
});

describe("refreshable", () => {
	function server() {
		let valid = "old";
		const fetch = mockFetch(call => call.headers.get("authorization") === `Bearer ${valid}`
			? json({ ok: true })
			: json({ error: "expired" }, { status: 401 }));
		return { fetch, rotate: (token: string) => { valid = token; } };
	}

	it("refreshes once on 401 and replays the request", async () => {
		const { fetch, rotate } = server();
		let token = "stale";
		rotate("fresh");
		const refresh = vi.fn(async () => { token = "fresh"; });
		const api = createClient({ baseUrl: base, fetch, auth: refreshable({ getToken: () => token, refresh }) });
		expect(await api.get("/me")).toEqual({ ok: true });
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("shares a single refresh between concurrent 401s", async () => {
		const { fetch, rotate } = server();
		let token = "stale";
		rotate("fresh");
		const refresh = vi.fn(async () => {
			await new Promise(r => setTimeout(r, 10));
			token = "fresh";
		});
		const api = createClient({ baseUrl: base, fetch, auth: refreshable({ getToken: () => token, refresh }) });
		const results = await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
		expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("never loops when the server keeps rejecting (1.x looped forever)", async () => {
		const fetch = mockFetch(json({}, { status: 401 }));
		const refresh = vi.fn(async () => true);
		const api = createClient({ baseUrl: base, fetch, auth: refreshable({ getToken: () => "t", refresh }) });
		const { error } = await api.get("/").safe();
		expect(error).toBeInstanceOf(HttpError);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("surfaces the 401 when refresh fails", async () => {
		const fetch = mockFetch(json({}, { status: 401 }));
		const api = createClient({ baseUrl: base, fetch, auth: refreshable({ getToken: () => "t", refresh: () => { throw new Error("no refresh token"); } }) });
		const { error } = await api.get("/").safe();
		expect((error as HttpError).status).toBe(401);
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
