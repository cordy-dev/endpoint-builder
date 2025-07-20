import { beforeEach, describe, expect, test, vi } from "vitest";

import { ApiKeyAuthStrategy,BearerAuthStrategy } from "../src/auth-strategies";
import { HttpClient } from "../src/core/http-client";
import { ExponentialBackoffRetryStrategy,FixedDelayRetryStrategy } from "../src/retry-strategies";

// Mock fetch globally
global.fetch = vi.fn();

describe("Integration Tests", () => {
	let client: HttpClient;

	beforeEach(() => {
		vi.clearAllMocks();
		client = new HttpClient("https://api.example.com");

		// Setup default fetch mock
		(global.fetch as any).mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			json: () => Promise.resolve({ success: true }),
			text: () => Promise.resolve("OK"),
			blob: () => Promise.resolve(new Blob()),
			headers: {
				get: (key: string) => key === "content-type" ? "application/json" : null,
				forEach: (callback: (value: string, key: string) => void) => {
					callback("application/json", "content-type");
				}
			}
		});
	});

	describe("End-to-End Request Flow", () => {
		test("should handle complete GET request with auth and retry", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.resolve({ id: 1, name: "John Doe", email: "john@example.com" }),
				text: () => Promise.resolve("OK"),
				blob: () => Promise.resolve(new Blob()),
				headers: {
					get: (key: string) => key === "content-type" ? "application/json" : null,
					forEach: (callback: (value: string, key: string) => void) => {
						callback("application/json", "content-type");
					}
				}
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const result = await client
				.get("/users/1")
				.auth(new BearerAuthStrategy(() => "test-token"))
				.retry({ attempts: 3, delay: 100, strategy: new FixedDelayRetryStrategy(3, 100) })
				.headers({ "Accept": "application/json" })
				.params({ include: "profile" })
				.timeout(5000)
				.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/users/1?include=profile",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						"Authorization": "Bearer test-token",
						"Accept": "application/json"
					})
				})
			);

			expect(result.status).toBe(200);
			expect(result.data).toEqual({ id: 1, name: "John Doe", email: "john@example.com" });
		});

		test("should handle POST request with JSON body", async () => {
			const mockResponse = {
				ok: true,
				status: 201,
				statusText: "Created",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ id: 2, name: "Jane Doe", created: true })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const userData = { name: "Jane Doe", email: "jane@example.com" };

			const result = await client
				.post("/users")
				.json(userData)
				.auth(new ApiKeyAuthStrategy(() => "api-key-123", "X-API-Key"))
				.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						"X-API-Key": "api-key-123"
					}),
					body: JSON.stringify(userData)
				})
			);

			expect(result.status).toBe(201);
			expect(result.data).toEqual({ id: 2, name: "Jane Doe", created: true });
		});

		test("should handle form data upload", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ uploaded: true, fileId: "abc123" })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const formData = new FormData();
			formData.append("file", "test-file-content");
			formData.append("description", "Test file upload");

			const result = await client
				.post("/upload")
				.form(formData)
				.auth(new BearerAuthStrategy(() => "upload-token"))
				.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/upload",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Authorization": "Bearer upload-token"
					}),
					body: formData
				})
			);

			expect(result.status).toBe(200);
			expect(result.data).toEqual({ uploaded: true, fileId: "abc123" });
		});

		test("should handle URL encoded form data", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ success: true, token: "new-token" })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const result = await client
				.post("/auth/login")
				.urlencoded({ username: "testuser", password: "testpass" })
				.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/auth/login",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/x-www-form-urlencoded"
					}),
					body: "username=testuser&password=testpass"
				})
			);

			expect(result.data).toEqual({ success: true, token: "new-token" });
		});
	});

	describe("Error Handling and Retry", () => {
		test("should retry on server errors", async () => {
			let callCount = 0;
			(global.fetch as any).mockImplementation(() => {
				callCount++;
				if (callCount < 3) {
					return Promise.resolve({
						ok: false,
						status: 500,
						statusText: "Internal Server Error",
						headers: new Map(),
						json: () => Promise.resolve({ error: "Server error" })
					});
				}
				// Success on third attempt
				return Promise.resolve({
					ok: true,
					status: 200,
					statusText: "OK",
					headers: new Map([["content-type", "application/json"]]),
					json: () => Promise.resolve({ success: true })
				});
			});

			const result = await client
				.get("/unstable-endpoint")
				.retry({ attempts: 3, delay: 50, strategy: new FixedDelayRetryStrategy(3, 50) })
				.execute();

			expect(callCount).toBe(3); // Initial attempt + 2 retries
			expect(result.status).toBe(200);
			expect(result.data).toEqual({ success: true });
		});

		test("should not retry on client errors", async () => {
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

			await expect(
				client
					.get("/nonexistent")
					.retry({ attempts: 3, delay: 50, strategy: new FixedDelayRetryStrategy(3, 50) })
					.execute()
			).rejects.toThrow("HTTP Error: 404 Not Found");

			expect(fetch).toHaveBeenCalledTimes(1); // No retries for 4xx errors
		});

		test("should handle exponential backoff retry", async () => {
			let callCount = 0;
			const callTimes: number[] = [];

			(global.fetch as any).mockImplementation(() => {
				callTimes.push(Date.now());
				callCount++;
				if (callCount < 3) {
					return Promise.resolve({
						ok: false,
						status: 503,
						statusText: "Service Unavailable",
						json: () => Promise.resolve({ error: "Service temporarily unavailable" }),
						text: () => Promise.resolve("Service Unavailable"),
						blob: () => Promise.resolve(new Blob()),
						headers: {
							get: (key: string) => key === "content-type" ? "application/json" : null,
							forEach: (callback: (value: string, key: string) => void) => {
								callback("application/json", "content-type");
							}
						}
					});
				}
				return Promise.resolve({
					ok: true,
					status: 200,
					statusText: "OK",
					json: () => Promise.resolve({ recovered: true }),
					text: () => Promise.resolve("OK"),
					blob: () => Promise.resolve(new Blob()),
					headers: {
						get: (key: string) => key === "content-type" ? "application/json" : null,
						forEach: (callback: (value: string, key: string) => void) => {
							callback("application/json", "content-type");
						}
					}
				});
			});

			const result = await client
				.get("/unstable-service")
				.retry({ attempts: 3, delay: 100, strategy: new ExponentialBackoffRetryStrategy(3, 50, 1000, 2) })
				.execute();

			expect(callCount).toBe(3);
			expect(result.data).toEqual({ recovered: true });

			// Check that delays increased exponentially
			if (callTimes.length >= 3) {
				const delay1 = callTimes[1]! - callTimes[0]!;
				const delay2 = callTimes[2]! - callTimes[1]!;
				// With exponential backoff: delay1 ≈ 50ms, delay2 ≈ 100ms
				expect(delay2).toBeGreaterThan(delay1 * 1.5); // Should be roughly 2x longer
			}
		});
	});

	describe("Mock Mode", () => {
		test("should use mock response when configured", async () => {
			const mockData = { id: 999, name: "Mock User", isMocked: true };

			const result = await client
				.get("/users/999")
				.mock({
					data: mockData,
					status: 200,
					statusText: "OK",
					delay: 10
				})
				.execute();

			// Should not make actual HTTP request
			expect(fetch).not.toHaveBeenCalled();
			expect(result.status).toBe(200);
			expect(result.data).toEqual(mockData);
		});

		test("should apply mock delay", async () => {
			const startTime = Date.now();

			await client
				.get("/delayed-endpoint")
				.mock({
					data: { delayed: true },
					status: 200,
					delay: 100
				})
				.execute();

			const elapsed = Date.now() - startTime;
			expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
		});

		test("should work in mock-only mode", async () => {
			await expect(
				client.get("/test").mockMode(true).execute()
			).rejects.toThrow("Mock-only mode is enabled but no mock response is configured");

			const result = await client
				.get("/test")
				.mockMode(true)
				.mock({ data: { mockOnly: true }, status: 200 })
				.execute();

			expect(result.data).toEqual({ mockOnly: true });
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe("Caching", () => {
		test("should cache GET requests", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.resolve({ cached: true, timestamp: Date.now() }),
				text: () => Promise.resolve("OK"),
				blob: () => Promise.resolve(new Blob()),
				headers: {
					get: (key: string) => key === "content-type" ? "application/json" : null,
					forEach: (callback: (value: string, key: string) => void) => {
						callback("application/json", "content-type");
					}
				}
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			// Make parallel requests to test caching/deduplication
			const [result1, result2] = await Promise.all([
				client.get("/cacheable").cache(true).execute(),
				client.get("/cacheable").cache(true).execute()
			]);

			expect(fetch).toHaveBeenCalledTimes(1); // Only one actual request due to deduplication
			expect(result1.data).toEqual(result2.data);
		});

		test("should not cache POST requests by default", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ created: true })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			// Make two identical POST requests
			await client.post("/create").json({ data: "test" }).execute();
			await client.post("/create").json({ data: "test" }).execute();

			expect(fetch).toHaveBeenCalledTimes(2); // Should not cache POST
		});
	});

	describe("Complex Workflows", () => {
		test("should handle authentication refresh workflow", async () => {
			let tokenExpired = false;

			// Mock auth endpoint
			(global.fetch as any).mockImplementation((url: string) => {
				if (url.includes("/auth/refresh")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						statusText: "OK",
						json: () => Promise.resolve({ accessToken: "new-token", refreshToken: "new-refresh" }),
						text: () => Promise.resolve("OK"),
						blob: () => Promise.resolve(new Blob()),
						headers: {
							get: (key: string) => key === "content-type" ? "application/json" : null,
							forEach: (callback: (value: string, key: string) => void) => {
								callback("application/json", "content-type");
							}
						}
					});
				}

				// Main API endpoint
				if (!tokenExpired) {
					tokenExpired = true;
					return Promise.resolve({
						ok: false,
						status: 401,
						statusText: "Unauthorized",
						json: () => Promise.resolve({ error: "Token expired" }),
						text: () => Promise.resolve("Unauthorized"),
						blob: () => Promise.resolve(new Blob()),
						headers: {
							get: (key: string) => key === "content-type" ? "application/json" : null,
							forEach: (callback: (value: string, key: string) => void) => {
								callback("application/json", "content-type");
							}
						}
					});
				}

				return Promise.resolve({
					ok: true,
					status: 200,
					statusText: "OK",
					json: () => Promise.resolve({ data: "success with new token" }),
					text: () => Promise.resolve("OK"),
					blob: () => Promise.resolve(new Blob()),
					headers: {
						get: (key: string) => key === "content-type" ? "application/json" : null,
						forEach: (callback: (value: string, key: string) => void) => {
							callback("application/json", "content-type");
						}
					}
				});
			});

			// This would require implementing refresh logic in the auth strategy
			// For now, just test that auth errors are handled
			await expect(
				client
					.get("/protected")
					.auth(new BearerAuthStrategy(() => "expired-token"))
					.execute()
			).rejects.toThrow("HTTP Error: 401 Unauthorized");

			expect(fetch).toHaveBeenCalled();
		});

		test("should handle multiple configuration methods chaining", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ complex: true })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const result = await client
				.get("/complex")
				.params({ page: 1, size: 10 })
				.headers({ "Accept": "application/json", "X-Custom": "value" })
				.auth(new BearerAuthStrategy(() => "complex-token"))
				.retry({ attempts: 2, delay: 100, strategy: new FixedDelayRetryStrategy(2, 100) })
				.cache(false)
				.timeout(10000)
				.responseType("json")
				.execute();

			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/complex?page=1&size=10",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						"Accept": "application/json",
						"X-Custom": "value",
						"Authorization": "Bearer complex-token"
					})
				})
			);

			expect(result.data).toEqual({ complex: true });
		});
	});

	describe("Data Extraction", () => {
		test("should extract data directly with data() method", async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: "OK",
				headers: new Map([["content-type", "application/json"]]),
				json: () => Promise.resolve({ extracted: true, value: 42 })
			};

			(global.fetch as any).mockResolvedValue(mockResponse);

			const data = await client
				.get("/extract-me")
				.data();

			expect(data).toEqual({ extracted: true, value: 42 });
			expect(fetch).toHaveBeenCalledWith(
				"https://api.example.com/extract-me",
				expect.objectContaining({ method: "GET" })
			);
		});

		test("should extract data from mock response", async () => {
			const mockData = { mocked: true, extracted: true };

			const data = await client
				.get("/mock-extract")
				.mock({ data: mockData, status: 200 })
				.data();

			expect(data).toEqual(mockData);
			expect(fetch).not.toHaveBeenCalled(); // Should use mock
		});
	});
});
