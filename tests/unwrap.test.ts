import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";
import { mockFetch } from "./utils/test-helpers";

describe("Response Unwrapping", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.resetAllMocks();
	});

	it("should unwrap response globally", async () => {
		global.fetch = mockFetch({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" }
		});

		const client = new HttpClient({
			baseUrl: "https://api.test.com",
			unwrap: (response) => (response as { data: unknown }).data
		});

		const user = await client.get("/users/1").data();
		expect(user).toEqual({ id: 1, name: "John" });
	});

	it("should disable unwrap for specific request", async () => {
		global.fetch = mockFetch({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" }
		});

		const client = new HttpClient({
			baseUrl: "https://api.test.com",
			unwrap: (response) => (response as { data: unknown }).data
		});

		const full = await client.get("/users/1").unwrap(false).data();
		expect(full).toEqual({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" }
		});
	});

	it("should use custom unwrap per request", async () => {
		global.fetch = mockFetch({ items: [1, 2, 3], total: 100 });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });

		const items = await client
			.get("/items")
			.unwrap((r) => (r as { items: number[] }).items)
			.data();

		expect(items).toEqual([1, 2, 3]);
	});

	it("should work without global unwrap", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });

		const user = await client.get("/users/1").data();
		expect(user).toEqual({ id: 1, name: "John" });
	});

	it("should override global unwrap with request unwrap", async () => {
		global.fetch = mockFetch({
			data: { items: [1, 2, 3] },
			meta: { total: 100 }
		});

		const client = new HttpClient({
			baseUrl: "https://api.test.com",
			unwrap: (response) => (response as { data: unknown }).data
		});

		// Override to get meta instead
		const meta = await client
			.get("/items")
			.unwrap((r) => (r as { meta: unknown }).meta)
			.data();

		expect(meta).toEqual({ total: 100 });
	});
});
