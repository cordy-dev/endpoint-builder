import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";
import { RequestBuilder } from "../src/core/RequestBuilder";
import { mockFetch } from "./utils/test-helpers";

describe("RequestBuilder", () => {
	// Save the original fetch
	const originalFetch = global.fetch;
	let client: HttpClient;

	beforeEach(() => {
		// Create a new client for each test
		client = new HttpClient({ baseUrl: "https://api.example.com" });
		// Clear mocks before each test
		vi.resetAllMocks();
	});

	afterEach(() => {
		// Restore the original fetch after each test
		global.fetch = originalFetch;
	});

	describe("method method", () => {
		it("should set the HTTP method", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.method("POST");

			expect(builder._method).toBe("POST");
		});
	});

	describe("query method", () => {
		it("should set query parameters", () => {
			const builder = new RequestBuilder(client, "/users");
			const query = { page: 1, limit: 10, filter: "active" };

			builder.query(query);

			expect(builder._query).toEqual(query);
		});
	});

	describe("headers and header methods", () => {
		it("should set multiple headers via object", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.headers({
				"Content-Type": "application/json",
				"X-API-Key": "test-api-key"
			});

			expect(builder._headers["Content-Type"]).toBe("application/json");
			expect(builder._headers["X-API-Key"]).toBe("test-api-key");
		});

		it("should set a single header", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.header("Authorization", "Bearer token123");

			expect(builder._headers["Authorization"]).toBe("Bearer token123");
		});

		it("should merge headers with multiple calls", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.headers({ "Content-Type": "application/json" });
			builder.header("X-API-Key", "test-api-key");

			expect(builder._headers["Content-Type"]).toBe("application/json");
			expect(builder._headers["X-API-Key"]).toBe("test-api-key");
		});
	});

	describe("responseType method", () => {
		it("should set the response type", () => {
			const builder = new RequestBuilder(client, "/images/1");

			builder.responseType("blob");

			expect(builder._responseType).toBe("blob");
		});
	});

	describe("body method", () => {
		it("should set the request body", () => {
			const builder = new RequestBuilder(client, "/users");
			const body = { name: "John", email: "john@example.com" };

			builder.body(body);

			expect(builder._body).toEqual(body);
		});
	});

	describe("json method", () => {
		it("should set request body and Content-Type: application/json header", () => {
			const builder = new RequestBuilder(client, "/users");
			const body = { name: "John", email: "john@example.com" };

			builder.json(body);

			expect(builder._body).toEqual(body);
			expect(builder._headers["Content-Type"]).toBe("application/json");
		});
	});

	describe("form method", () => {
		it("should set FormData as request body", () => {
			const builder = new RequestBuilder(client, "/users");
			const formData = new FormData();
			formData.append("name", "John");
			formData.append("email", "john@example.com");

			builder.form(formData, false);

			expect(builder._body).toBe(formData);
			expect(builder._headers["Content-Type"]).toBe("multipart/form-data");
		});

		it("should convert object to FormData", () => {
			const builder = new RequestBuilder(client, "/users");
			const data = { name: "John", email: "john@example.com" };

			builder.form(data);

			expect(builder._body).toBeInstanceOf(FormData);
			expect(builder._headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
		});

		it("should ignore null and undefined values when creating FormData", () => {
			const builder = new RequestBuilder(client, "/users");
			const data = { name: "John", email: null, age: undefined, active: false };

			builder.form(data);

			const formData = builder._body as FormData;
			expect(formData.has("name")).toBe(true);
			expect(formData.has("active")).toBe(true);
			expect(formData.has("email")).toBe(false);
			expect(formData.has("age")).toBe(false);
		});
	});

	describe("auth method", () => {
		it("should set authentication strategy", () => {
			const builder = new RequestBuilder(client, "/users");
			const authStrategy = {
				enrich: vi.fn().mockResolvedValue({ Authorization: "Bearer token123" })
			};

			builder.auth(authStrategy);

			expect(builder._auth).toBe(authStrategy);
		});

		it("should allow disabling authentication for a request", () => {
			const builder = new RequestBuilder(client, "/public/data");

			builder.auth(null);

			expect(builder._auth).toBeNull();
		});
	});

	describe("dedupe method", () => {
		it("should enable or disable request deduplication", () => {
			const builder = new RequestBuilder(client, "/users");

			// By default should be equal to the value from HttpClient
			expect(builder._dedupe).toBe(false);

			builder.dedupe(true);
			expect(builder._dedupe).toBe(true);

			builder.dedupe(false);
			expect(builder._dedupe).toBe(false);
		});
	});

	describe("data method", () => {
		it("should execute the request and return only the data", async () => {
			// Mock fetch
			const mockResponseData = { id: 1, name: "Test User" };
			global.fetch = mockFetch(mockResponseData);

			const builder = new RequestBuilder(client, "/users/1").method("GET");
			const result = await builder.data();

			expect(result).toEqual(mockResponseData);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("send method", () => {
		it("should execute the request and return the full response", async () => {
			// Mock fetch
			const mockResponseData = { id: 1, name: "Test User" };
			global.fetch = mockFetch(mockResponseData, 200, { "Content-Type": "application/json" });

			const builder = new RequestBuilder(client, "/users/1").method("GET");
			const response = await builder.send();

			expect(response.data).toEqual(mockResponseData);
			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toBe("application/json");
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("timeout method", () => {
		it("should set the request timeout", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.timeout(5000);

			expect(builder._timeout).toBe(5000);
		});
	});

	describe("signal method", () => {
		it("should set AbortSignal for the request", () => {
			const builder = new RequestBuilder(client, "/users");
			const controller = new AbortController();

			builder.signal(controller.signal);

			expect(builder._signal).toBe(controller.signal);
		});
	});

	describe("retry method", () => {
		it("should set the retry strategy", () => {
			const builder = new RequestBuilder(client, "/users");
			const retryStrategy = {
				shouldRetry: vi.fn().mockReturnValue(true),
				nextDelay: vi.fn().mockReturnValue(1000)
			};

			builder.retry(retryStrategy);

			expect(builder._retry).toBe(retryStrategy);
		});

		it("should allow disabling retries", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.retry(null);

			expect(builder._retry).toBeNull();
		});
	});

	describe("method chaining", () => {
		it("should support method call chaining", async () => {
			// Mock fetch
			global.fetch = mockFetch({ success: true });

			const result = await client
				.post("/users")
				.json({ name: "John", email: "john@example.com" })
				.header("X-API-Key", "test-api-key")
				.timeout(3000)
				.dedupe(true)
				.data();

			expect(result).toEqual({ success: true });
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						"X-API-Key": "test-api-key"
					})
				})
			);
		});
	});
});
