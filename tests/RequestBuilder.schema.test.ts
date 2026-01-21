import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";
import { ValidationError } from "../src/errors";
import type { StandardSchema } from "../src/types/schema";
import { mockFetch } from "./utils/test-helpers";

// Mock schema that follows Standard Schema interface
const UserSchema: StandardSchema<{ id: number; name: string }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				typeof (value as { id: unknown }).id === "number" &&
				"name" in value &&
				typeof (value as { name: unknown }).name === "string"
			) {
				return { value: value as { id: number; name: string } };
			}
			return { issues: [{ message: "Invalid user object" }] };
		}
	}
};

describe("RequestBuilder Schema Validation", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.resetAllMocks();
	});

	it("should validate response with schema", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const user = await client.get("/users/1").schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "John" });
	});

	it("should throw ValidationError for invalid response", async () => {
		global.fetch = mockFetch({ invalid: "data" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });

		await expect(client.get("/users/1").schema(UserSchema)).rejects.toThrow(
			ValidationError
		);
	});

	it("should return Result with safe()", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const result = await client.get("/users/1").schema(UserSchema).safe();

		expect(result.error).toBeUndefined();
		expect(result.data).toEqual({ id: 1, name: "John" });
	});

	it("should return error in Result for invalid response", async () => {
		global.fetch = mockFetch({ invalid: "data" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const result = await client.get("/users/1").schema(UserSchema).safe();

		expect(result.data).toBeUndefined();
		expect(result.error).toBeInstanceOf(ValidationError);
	});

	it("should preserve request options when using schema", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const user = await client
			.get("/users/1")
			.headers({ "X-Custom": "value" })
			.timeout(5000)
			.schema(UserSchema);

		expect(user).toEqual({ id: 1, name: "John" });
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.test.com/users/1",
			expect.objectContaining({
				headers: expect.objectContaining({
					"X-Custom": "value"
				})
			})
		);
	});

	it("should support transform after schema validation", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const result = await client
			.get("/users/1")
			.schema(UserSchema)
			.transform((user) => ({
				...user,
				displayName: user.name.toUpperCase()
			}));

		expect(result).toEqual({
			id: 1,
			name: "John",
			displayName: "JOHN"
		});
	});

	it("should support safe mode with transform", async () => {
		global.fetch = mockFetch({ id: 1, name: "John" });

		const client = new HttpClient({ baseUrl: "https://api.test.com" });
		const result = await client
			.get("/users/1")
			.schema(UserSchema)
			.transform((user) => user.name.toUpperCase())
			.safe();

		expect(result.error).toBeUndefined();
		expect(result.data).toBe("JOHN");
	});
});
