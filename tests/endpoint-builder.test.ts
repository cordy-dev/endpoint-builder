import { beforeEach, describe, expect, test, vi } from "vitest";

import { BearerAuthStrategy } from "../src/auth-strategies";
import { EndpointBuilder } from "../src/core/endpoint-builder";
import { ExponentialBackoffRetryStrategy } from "../src/retry-strategies";

// Mock fetch globally
global.fetch = vi.fn();

describe("EndpointBuilder", () => {
	let builder: EndpointBuilder;

	beforeEach(() => {
		vi.clearAllMocks();
		builder = new EndpointBuilder("https://api.example.com/users", "GET");
	});

	describe("Constructor", () => {
		test("should create builder with URL and method", () => {
			const builder = new EndpointBuilder("https://api.example.com/test", "POST");
			expect(builder).toBeInstanceOf(EndpointBuilder);
		});

		test("should default to GET method", () => {
			const builder = new EndpointBuilder("https://api.example.com/test");
			expect(builder).toBeInstanceOf(EndpointBuilder);
		});
	});

	describe("URL Parameters", () => {
		test("should handle absolute URL with params", () => {
			const result = builder.params({ page: 1, limit: 10 });
			expect(result).toBe(builder); // Fluent API
		});

		test("should handle relative URL with params", () => {
			const relativeBuilder = new EndpointBuilder("/users", "GET");
			const result = relativeBuilder.params({ page: 1, limit: 10 });
			expect(result).toBe(relativeBuilder);
		});

		test("should ignore null and undefined params", () => {
			const result = builder.params({ page: 1, empty: null, missing: undefined });
			expect(result).toBe(builder);
		});

		test("should convert params to strings", () => {
			const result = builder.params({ page: 1, active: true });
			expect(result).toBe(builder);
		});
	});

	describe("Headers", () => {
		test("should set multiple headers", () => {
			const result = builder.headers({
				"Accept": "application/json",
				"X-Custom-Header": "test-value"
			});
			expect(result).toBe(builder);
		});

		test("should set single header", () => {
			const result = builder.header("Authorization", "Bearer token");
			expect(result).toBe(builder);
		});

		test("should merge headers", () => {
			const result = builder
				.headers({ "Accept": "application/json" })
				.header("Authorization", "Bearer token");
			expect(result).toBe(builder);
		});
	});

	describe("Request Body", () => {
		test("should set JSON body", () => {
			const data = { name: "John", email: "john@example.com" };
			const result = builder.json(data);
			expect(result).toBe(builder);
		});

		test("should set form data body with FormData", () => {
			const formData = new FormData();
			formData.append("file", "test-content");
			const result = builder.form(formData);
			expect(result).toBe(builder);
		});

		test("should set form data body with object", () => {
			const data = { username: "john", password: "secret" };
			const result = builder.form(data);
			expect(result).toBe(builder);
		});

		test("should set URL encoded body", () => {
			const data = { username: "john", password: "secret" };
			const result = builder.urlencoded(data);
			expect(result).toBe(builder);
		});

		test("should set raw body", () => {
			const result = builder.body("raw string data");
			expect(result).toBe(builder);
		});

		test("should ignore null and undefined in form data", () => {
			const data = { username: "john", empty: null, missing: undefined };
			const result = builder.form(data);
			expect(result).toBe(builder);
		});
	});

	describe("Configuration", () => {
		test("should set timeout", () => {
			const result = builder.timeout(5000);
			expect(result).toBe(builder);
		});

		test("should set response type", () => {
			const result = builder.responseType("json");
			expect(result).toBe(builder);
		});

		test("should configure retry", () => {
			const retryConfig = {
				attempts: 3,
				delay: 1000,
				strategy: new ExponentialBackoffRetryStrategy(3, 1000)
			};
			const result = builder.retry(retryConfig);
			expect(result).toBe(builder);
		});

		test("should set auth strategy", () => {
			const auth = new BearerAuthStrategy(() => "test-token");
			const result = builder.auth(auth);
			expect(result).toBe(builder);
		});

		test("should disable auth with null", () => {
			const result = builder.auth(null);
			expect(result).toBe(builder);
		});

		test("should disable auth with noAuth()", () => {
			const result = builder.noAuth();
			expect(result).toBe(builder);
		});

		test("should set mock response", () => {
			const mockResponse = {
				data: { id: 1, name: "Test" },
				status: 200,
				delay: 100
			};
			const result = builder.mock(mockResponse);
			expect(result).toBe(builder);
		});

		test("should enable mock mode", () => {
			const result = builder.mockMode(true);
			expect(result).toBe(builder);
		});

		test("should enable caching", () => {
			const result = builder.cache(true);
			expect(result).toBe(builder);
		});
	});

	describe("Execution", () => {
		test("should execute mock response", async () => {
			const mockData = { id: 1, name: "Test User" };

			const result = await builder
				.mock({
					data: mockData,
					status: 200,
					statusText: "OK"
				})
				.execute();

			expect(result.data).toEqual(mockData);
			expect(result.status).toBe(200);
			expect(result.statusText).toBe("OK");
		});

		test("should return only data with data() method", async () => {
			const mockData = { id: 1, name: "Test User" };

			const result = await builder
				.mock({
					data: mockData,
					status: 200
				})
				.data();

			expect(result).toEqual(mockData);
		});

		test("should throw error in mock-only mode without mock", async () => {
			await expect(
				builder.mockMode(true).execute()
			).rejects.toThrow("Mock-only mode is enabled but no mock response is configured");
		});

		test("should execute with mock delay", async () => {
			const startTime = Date.now();

			await builder
				.mock({
					data: { test: true },
					status: 200,
					delay: 100
				})
				.execute();

			const elapsed = Date.now() - startTime;
			expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
		});
	});

	describe("Request Execution with Fetch", () => {
		beforeEach(() => {
			// Mock successful fetch response
			(global.fetch as any).mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ id: 1, name: "Test" })
			});
		});

		test("should make actual HTTP request", async () => {
			const response = await builder.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.objectContaining({
					method: "GET",
					headers: {},
					body: undefined,
					signal: undefined
				})
			);

			expect(response.status).toBe(200);
			expect(response.data).toEqual({ id: 1, name: "Test" });
		});

		test("should handle JSON response", async () => {
			const response = await builder.json({ test: "data" }).execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.objectContaining({
					method: "GET",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ test: "data" })
				})
			);
		});
	});

	describe("Error Handling", () => {
		test("should handle HTTP errors", async () => {
			(global.fetch as any).mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
				json: () => Promise.resolve({ error: "Not found" }),
				text: () => Promise.resolve("Not found"),
				blob: () => Promise.resolve(new Blob()),
				headers: {
					get: (key: string) => key === "content-type" ? "application/json" : null,
					forEach: (callback: (value: string, key: string) => void) => {
						callback("application/json", "content-type");
					}
				}
			});

			await expect(builder.execute()).rejects.toThrow("HTTP Error: 404 Not Found");
		});

		test("should handle network errors", async () => {
			(global.fetch as any).mockRejectedValue(new Error("Network error"));

			await expect(builder.execute()).rejects.toThrow("Network error");
		});
	});
});
