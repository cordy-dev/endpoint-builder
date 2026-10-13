import { describe, expect, it } from "vitest";

import { apiKey, createClient, type EndpointError } from "../src";
import { redactUrl } from "../src/utils/url";
import { hangingFetch, json, mockFetch } from "./helpers";

const secret = "sk-SECRET-123";
const base = "https://api.test";
const keyed = { auth: apiKey(secret, { query: "api_key" }), retry: false } as const;

/** `masked`: the error was created while the credentials were applied to the URL, so they must show as `***` */
function expectClean(error: EndpointError | undefined, masked = false) {
	expect(error).toBeDefined();
	expect(error!.message).not.toContain(secret);
	expect(error!.request?.url).not.toContain(secret);
	if (masked) {
		expect(error!.message).toContain("api_key=***");
		expect(error!.request?.url).toContain("api_key=***");
	}
}

describe("credentials in URLs never reach errors", () => {
	it("is masked in every error type, while the real URL is still sent", async () => {
		const network = mockFetch(() => { throw new TypeError("fetch failed"); });
		expectClean((await createClient({ baseUrl: base, fetch: network, ...keyed }).get("/x").safe()).error, true);
		expect(network.calls[0]!.url).toBe(`${base}/x?api_key=${secret}`);

		expectClean((await createClient({ baseUrl: base, fetch: hangingFetch(), timeout: 20, ...keyed }).get("/x").safe()).error, true);
		expectClean((await createClient({ baseUrl: base, fetch: mockFetch(json({}, { status: 500 })), ...keyed }).get("/x").safe()).error);

		const aborted = await createClient({ baseUrl: base, fetch: hangingFetch(), ...keyed }).get("/x").signal(AbortSignal.abort()).safe();
		expect(aborted.error?.message).not.toContain(secret);

		const invalid = await createClient({ baseUrl: base, fetch: mockFetch(json({})), ...keyed }).post("/x", { json: {} })
			.json({}, { "~standard": { version: 1, vendor: "t", validate: () => ({ issues: [{ message: "nope" }] }) } })
			.safe();
		expectClean(invalid.error);
	});

	it("masks credential-like params passed by the caller, keeps the others", async () => {
		const api = createClient({ baseUrl: base, fetch: mockFetch(json({}, { status: 404 })), retry: false });
		const { error } = await api.get("/x", { query: { token: secret, page: 2, signature: "abc" } }).safe();
		expect(error!.message).toBe(`HTTP 404 (GET ${base}/x?token=***&page=2&signature=***)`);
	});

	it("hooks and middleware still see the real URL", async () => {
		const seen: string[] = [];
		const api = createClient({ baseUrl: base, fetch: mockFetch(json({})), onResponse: (_response, ctx) => { seen.push(ctx.url); }, ...keyed });
		await api.get("/x");
		expect(seen).toEqual([`${base}/x`]); // credentials are applied below the hooks layer
	});
});

describe("redactUrl", () => {
	it("masks values by parameter name", () => {
		expect(redactUrl("https://a.test/x")).toBe("https://a.test/x");
		expect(redactUrl("https://a.test/x?api_key=1&apiKey=2&access_token=3&client-secret=4&password=5&Signature=6&page=1&sort=asc&monkey=7"))
			.toBe("https://a.test/x?api_key=***&apiKey=***&access_token=***&client-secret=***&password=***&Signature=***&page=1&sort=asc&monkey=***");
		expect(redactUrl("/x?auth=1&author=jane&flag")).toBe("/x?auth=***&author=jane&flag");
	});

	it("handles fragments and encoded names", () => {
		expect(redactUrl("https://a.test/x?token=1#top?token=2")).toBe("https://a.test/x?token=***#top?token=2");
		expect(redactUrl("https://a.test/x?to%6Ben=1&%E0%A4%A=2")).toBe("https://a.test/x?to%6Ben=***&%E0%A4%A=2");
	});
});
