import { afterEach, describe, expect, it, vi } from "vitest";

import { basicAuth, bearerAuth, refreshAuth } from "../src/auth/helpers";
import { createClient } from "../src/client";
import { HttpError, ValidationError } from "../src/errors";
import type { StandardSchema } from "../src/types/schema";
import { mockFetch } from "./utils/test-helpers";

// Type-safe schema for User
const UserSchema: StandardSchema<{ id: number; name: string; email: string }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				typeof (value as Record<string, unknown>).id === "number" &&
				"name" in value &&
				typeof (value as Record<string, unknown>).name === "string" &&
				"email" in value &&
				typeof (value as Record<string, unknown>).email === "string"
			) {
				return { value: value as { id: number; name: string; email: string } };
			}
			return { issues: [{ message: "Invalid user object" }] };
		},
	},
};

// Schema for paginated response
const PaginatedUsersSchema: StandardSchema<{ users: Array<{ id: number; name: string }>, total: number }> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"users" in value &&
				Array.isArray((value as Record<string, unknown>).users) &&
				"total" in value &&
				typeof (value as Record<string, unknown>).total === "number"
			) {
				return { value: value as { users: Array<{ id: number; name: string }>, total: number } };
			}
			return { issues: [{ message: "Invalid paginated response" }] };
		},
	},
};

describe("Typed Client Integration Tests", () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
		vi.resetAllMocks();
	});

	describe("Full API workflow with schema validation", () => {
		it("should fetch user with path params and validate response", async () => {
			global.fetch = mockFetch({ id: 1, name: "John Doe", email: "john@example.com" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			const user = await api
				.get("/users/:id", { params: { id: 1 } })
				.schema(UserSchema);

			expect(user).toEqual({ id: 1, name: "John Doe", email: "john@example.com" });
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users/1",
				expect.anything()
			);
		});

		it("should create user with POST and validate response", async () => {
			global.fetch = mockFetch({ id: 42, name: "Jane Doe", email: "jane@example.com" }, 201);

			const api = createClient({ baseUrl: "https://api.example.com" });
			const user = await api
				.post("/users", { body: { name: "Jane Doe", email: "jane@example.com" } })
				.schema(UserSchema);

			expect(user.id).toBe(42);
			expect(user.name).toBe("Jane Doe");
		});

		it("should update user with PUT and validate", async () => {
			global.fetch = mockFetch({ id: 1, name: "John Updated", email: "john.updated@example.com" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			const user = await api
				.put("/users/:id", { params: { id: 1 }, body: { name: "John Updated", email: "john.updated@example.com" } })
				.schema(UserSchema);

			expect(user.name).toBe("John Updated");
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users/1",
				expect.objectContaining({ method: "PUT" })
			);
		});
	});

	describe("Safe mode error handling", () => {
		it("should return validation error in safe mode", async () => {
			global.fetch = mockFetch({ invalid: "response" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			const result = await api
				.get("/users/:id", { params: { id: 1 } })
				.schema(UserSchema)
				.safe();

			expect(result.data).toBeUndefined();
			expect(result.error).toBeInstanceOf(ValidationError);
		});

		it("should return HTTP error in safe mode", async () => {
			global.fetch = mockFetch({ error: "Not Found" }, 404);

			const api = createClient({ baseUrl: "https://api.example.com" });
			// Note: safe() is only available after schema(), so use schema for error handling
			const result = await api
				.get("/users/:id", { params: { id: 999 } })
				.schema(UserSchema)
				.safe();

			expect(result.data).toBeUndefined();
			expect(result.error).toBeInstanceOf(Error);
			expect((result.error as HttpError).status).toBe(404);
		});

		it("should return success in safe mode", async () => {
			global.fetch = mockFetch({ id: 1, name: "John", email: "john@test.com" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			const result = await api
				.get("/users/:id", { params: { id: 1 } })
				.schema(UserSchema)
				.safe();

			expect(result.error).toBeUndefined();
			expect(result.data).toEqual({ id: 1, name: "John", email: "john@test.com" });
		});
	});

	describe("Auth helpers integration", () => {
		it("should work with bearer auth", async () => {
			global.fetch = mockFetch({ id: 1, name: "Auth User", email: "auth@test.com" });

			const api = createClient({
				baseUrl: "https://api.example.com",
				authStrategy: bearerAuth("my-secure-token"),
			});

			await api.get("/users/me").data();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer my-secure-token",
					}),
				})
			);
		});

		it("should work with basic auth", async () => {
			global.fetch = mockFetch({ authenticated: true });

			const api = createClient({
				baseUrl: "https://api.example.com",
				authStrategy: basicAuth("username", "password123"),
			});

			await api.get("/protected").data();

			const expectedAuth = "Basic " + btoa("username:password123");
			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: expectedAuth,
					}),
				})
			);
		});

		it("should work with dynamic bearer auth", async () => {
			let token = "initial-token";
			// Create new Response for each call to avoid "body already read" error
			global.fetch = vi.fn().mockImplementation(() =>
				Promise.resolve(new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}))
			);

			const api = createClient({
				baseUrl: "https://api.example.com",
				authStrategy: bearerAuth(() => token),
			});

			await api.get("/data").data();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer initial-token",
					}),
				})
			);

			// Update token
			token = "updated-token";
			await api.get("/data").data();

			expect(global.fetch).toHaveBeenLastCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer updated-token",
					}),
				})
			);
		});

		it("should work with refresh auth and auto-refresh on 401", async () => {
			let currentToken = "old-token";

			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response(null, { status: 401 }))
				.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}));

			const api = createClient({
				baseUrl: "https://api.example.com",
				authStrategy: refreshAuth({
					getToken: () => currentToken,
					getRefreshToken: () => "refresh-token",
					refresh: () => {
						currentToken = "new-token";
						return Promise.resolve(currentToken);
					},
				}),
			});

			const result = await api.get("/protected").data();

			expect(result).toEqual({ success: true });
			expect(currentToken).toBe("new-token");
			expect(global.fetch).toHaveBeenCalledTimes(2);
		});
	});

	describe("Response unwrapping with schema", () => {
		it("should unwrap response then validate with schema", async () => {
			global.fetch = mockFetch({
				data: { id: 1, name: "Wrapped User", email: "wrapped@test.com" },
				meta: { timestamp: "2024-01-01" },
			});

			const api = createClient({
				baseUrl: "https://api.example.com",
				unwrap: (r) => (r as { data: unknown }).data,
			});

			const user = await api
				.get("/users/:id", { params: { id: 1 } })
				.schema(UserSchema);

			expect(user).toEqual({ id: 1, name: "Wrapped User", email: "wrapped@test.com" });
		});

		it("should disable unwrap per request when needed", async () => {
			global.fetch = mockFetch({
				data: { id: 1, name: "Test" },
				meta: { version: "1.0" },
			});

			const api = createClient({
				baseUrl: "https://api.example.com",
				unwrap: (r) => (r as { data: unknown }).data,
			});

			const result = await api
				.get("/users/:id", { params: { id: 1 } })
				.unwrap(false)
				.data();

			expect(result).toEqual({
				data: { id: 1, name: "Test" },
				meta: { version: "1.0" },
			});
		});
	});

	describe("Transform chains", () => {
		it("should transform validated data", async () => {
			global.fetch = mockFetch({ id: 1, name: "Transform Test", email: "test@transform.com" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			const email = await api
				.get("/users/:id", { params: { id: 1 } })
				.schema(UserSchema)
				.transform((user) => user.email);

			expect(email).toBe("test@transform.com");
		});

		it("should transform to different type", async () => {
			global.fetch = mockFetch({
				users: [
					{ id: 1, name: "User 1" },
					{ id: 2, name: "User 2" },
				],
				total: 100,
			});

			const api = createClient({ baseUrl: "https://api.example.com" });
			const userNames = await api
				.get("/users", { query: { page: 1 } })
				.schema(PaginatedUsersSchema)
				.transform((response) => response.users.map((u) => u.name));

			expect(userNames).toEqual(["User 1", "User 2"]);
		});
	});

	describe("Query parameters and headers", () => {
		it("should send query parameters correctly", async () => {
			global.fetch = mockFetch({ users: [], total: 0 });

			const api = createClient({ baseUrl: "https://api.example.com" });
			await api.get("/users", { query: { page: 2, limit: 20, sort: "name" } }).data();

			const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
			expect(calledUrl).toContain("page=2");
			expect(calledUrl).toContain("limit=20");
			expect(calledUrl).toContain("sort=name");
		});

		it("should merge custom headers with defaults", async () => {
			global.fetch = mockFetch({ success: true });

			const api = createClient({
				baseUrl: "https://api.example.com",
				headers: { "X-Client-Version": "1.0" },
			});

			await api.get("/data", { headers: { "X-Request-ID": "abc123" } }).data();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Client-Version": "1.0",
						"X-Request-ID": "abc123",
					}),
				})
			);
		});
	});

	describe("Multiple path parameters", () => {
		it("should handle multiple path params", async () => {
			global.fetch = mockFetch({ commentId: 5, text: "Test comment" });

			const api = createClient({ baseUrl: "https://api.example.com" });
			await api.get("/posts/:postId/comments/:commentId", {
				params: { postId: 10, commentId: 5 },
			}).data();

			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/posts/10/comments/5",
				expect.anything()
			);
		});
	});

	describe("Shorthand auth options", () => {
		it("should support simple auth string for bearer token", async () => {
			global.fetch = mockFetch({ success: true });

			const api = createClient({
				baseUrl: "https://api.example.com",
				auth: "my-token",
			});

			await api.get("/protected").data();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer my-token",
					}),
				})
			);
		});

		it("should support apiKey option", async () => {
			global.fetch = mockFetch({ success: true });

			const api = createClient({
				baseUrl: "https://api.example.com",
				apiKey: "my-api-key",
			});

			await api.get("/data").data();

			expect(global.fetch).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-API-Key": "my-api-key",
					}),
				})
			);
		});
	});
});
