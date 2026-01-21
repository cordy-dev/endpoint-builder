import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "../src/client";
import { ValidationError } from "../src/errors";
import type { StandardSchema } from "../src/types/schema";
import { mockFetch } from "./utils/test-helpers";

const UserSchema: StandardSchema<{ id: number; name: string }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				typeof (value as any).id === "number" &&
				"name" in value &&
				typeof (value as any).name === "string"
			) {
				return { value: value as { id: number; name: string } };
			}
			return { issues: [{ message: "Invalid user" }] };
		},
	},
};

describe("createClient", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.resetAllMocks();
	});

	it("should create client with minimal config", () => {
		const api = createClient({ baseUrl: "https://api.test.com" });
		expect(api).toBeDefined();
		expect(typeof api.get).toBe("function");
		expect(typeof api.post).toBe("function");
	});

	it("should make GET request with path params", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const user = await api
			.get("/users/:id", { params: { id: 1 } })
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "John" });
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/users/1",
			expect.anything()
		);
	});

	it("should make GET request without path params", async () => {
		global.fetch = mockFetch([{ id: 1, name: "John" }]);

		const api = createClient({ baseUrl: "https://api.test.com" });
		const users = await api.get("/users").data();

		expect(users).toEqual([{ id: 1, name: "John" }]);
	});

	it("should make POST request with body", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const user = await api
			.post("/users", { body: { name: "John" } })
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "John" });
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/users",
			expect.objectContaining({
				method: "POST",
			})
		);
	});

	it("should support safe mode with schema validation", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const result = await api
			.get("/users/:id", { params: { id: 1 } })
			.schema(UserSchema)
			.safe();

		expect(result.data).toEqual({ id: 1, name: "John" });
		expect(result.error).toBeUndefined();
	});

	it("should return validation error in safe mode", async () => {
		global.fetch = mockFetch({ invalid: "data" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const result = await api
			.get("/users/:id", { params: { id: 1 } })
			.schema(UserSchema)
			.safe();

		expect(result.data).toBeUndefined();
		expect(result.error).toBeInstanceOf(ValidationError);
	});

	it("should support query parameters", async () => {
		global.fetch = mockFetch([{ id: 1, name: "John" }]);

		const api = createClient({ baseUrl: "https://api.test.com" });
		await api.get("/users", { query: { page: 1, limit: 10 } }).data();

		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining("page=1"),
			expect.anything()
		);
		expect(global.fetch).toHaveBeenCalledWith(
			expect.stringContaining("limit=10"),
			expect.anything()
		);
	});

	it("should support custom headers per request", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		await api.get("/users/:id", {
			params: { id: 1 },
			headers: { "X-Custom-Header": "value" },
		}).data();

		expect(global.fetch).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				headers: expect.objectContaining({
					"X-Custom-Header": "value",
				}),
			})
		);
	});

	it("should support PUT request with path params and body", async () => {
		global.fetch = mockFetch({ id: 1, name: "Updated" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const user = await api
			.put("/users/:id", { params: { id: 1 }, body: { name: "Updated" } })
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "Updated" });
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/users/1",
			expect.objectContaining({ method: "PUT" })
		);
	});

	it("should support PATCH request", async () => {
		global.fetch = mockFetch({ id: 1, name: "Patched" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const user = await api
			.patch("/users/:id", { params: { id: 1 }, body: { name: "Patched" } })
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "Patched" });
	});

	it("should support DELETE request", async () => {
		global.fetch = mockFetch({ success: true }, 200);

		const api = createClient({ baseUrl: "https://api.test.com" });
		await api.delete("/users/:id", { params: { id: 1 } }).send();

		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/users/1",
			expect.objectContaining({ method: "DELETE" })
		);
	});

	it("should work with response unwrapping", async () => {
		global.fetch = mockFetch({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" },
		});

		const api = createClient({
			baseUrl: "https://api.test.com",
			unwrap: (r) => (r as { data: unknown }).data,
		});

		const user = await api
			.get("/users/:id", { params: { id: 1 } })
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "John" });
	});

	it("should allow disabling unwrap per request", async () => {
		global.fetch = mockFetch({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" },
		});

		const api = createClient({
			baseUrl: "https://api.test.com",
			unwrap: (r) => (r as { data: unknown }).data,
		});

		const result = await api
			.get("/users/:id", { params: { id: 1 } })
			.unwrap(false)
			.data();

		expect(result).toEqual({
			data: { id: 1, name: "John" },
			meta: { timestamp: "2024-01-01" },
		});
	});

	it("should support transform after schema validation", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const api = createClient({ baseUrl: "https://api.test.com" });
		const name = await api
			.get("/users/:id", { params: { id: 1 } })
			.schema(UserSchema)
			.transform((user) => user.name);

		expect(name).toBe("John");
	});
});
