import { describe, expect, test } from "vitest";

import {
	ApiKeyAuthStrategy,
	BasicAuthStrategy,
	BearerAuthStrategy,
	CustomAuthStrategy,
	OpaqueTokenAuthStrategy,
	RefreshableBearerAuthStrategy
} from "../src/auth-strategies";
import { RefreshRotationStrategy } from "../src/auth-strategies/refresh-rotation.strategy";
import type { HttpError,HttpRequestConfig } from "../src/core/types";

describe("Authentication Strategies", () => {
	describe("BearerAuthStrategy", () => {
		test("should apply bearer token from function", async () => {
			const strategy = new BearerAuthStrategy(() => "test-token");
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Authorization"]).toBe("Bearer test-token");
		});

		test("should apply bearer token from async function", async () => {
			const strategy = new BearerAuthStrategy(async () => {
				await new Promise(resolve => setTimeout(resolve, 1)); // Simulate async work
				return "async-token";
			});
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Authorization"]).toBe("Bearer async-token");
		});

		test("should handle empty token gracefully", async () => {
			const strategy = new BearerAuthStrategy(() => "");
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Authorization"]).toBeUndefined();
		});

		test("should detect 401 as auth error", () => {
			const strategy = new BearerAuthStrategy(() => "test-token");
			const error: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			expect(strategy.isAuthError(error)).toBe(true);
		});

		test("should not detect 200 as auth error", () => {
			const strategy = new BearerAuthStrategy(() => "test-token");
			const error: HttpError = {
				name: "HttpError",
				message: "OK",
				config: { url: "test", method: "GET" },
				status: 200
			};

			expect(strategy.isAuthError(error)).toBe(false);
		});
	});

	describe("ApiKeyAuthStrategy", () => {
		test("should apply API key to default header", async () => {
			const strategy = new ApiKeyAuthStrategy(() => "secret-key");
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["X-API-Key"]).toBe("secret-key");
		});

		test("should apply API key to custom header", async () => {
			const strategy = new ApiKeyAuthStrategy(() => "secret-key", "API-KEY");
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["API-KEY"]).toBe("secret-key");
		});

		test("should detect 401 and 403 as auth errors", () => {
			const strategy = new ApiKeyAuthStrategy(() => "key");

			const error401: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			const error403: HttpError = {
				name: "HttpError",
				message: "Forbidden",
				config: { url: "test", method: "GET" },
				status: 403
			};

			expect(strategy.isAuthError(error401)).toBe(true);
			expect(strategy.isAuthError(error403)).toBe(true);
		});
	});

	describe("BasicAuthStrategy", () => {
		test("should apply basic auth", async () => {
			const strategy = new BasicAuthStrategy(() => ({ username: "user", password: "pass" }));
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			const expected = "Basic " + btoa("user:pass");
			expect(result.headers?.["Authorization"]).toBe(expected);
		});

		test("should apply basic auth from async function", async () => {
			const strategy = new BasicAuthStrategy(async () => {
				await new Promise(resolve => setTimeout(resolve, 1));
				return { username: "async-user", password: "async-pass" };
			});
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			const expected = "Basic " + btoa("async-user:async-pass");
			expect(result.headers?.["Authorization"]).toBe(expected);
		});

		test("should detect 401 as auth error", () => {
			const strategy = new BasicAuthStrategy(() => ({ username: "user", password: "pass" }));
			const error: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			expect(strategy.isAuthError(error)).toBe(true);
		});
	});

	describe("CustomAuthStrategy", () => {
		test("should apply custom auth logic", async () => {
			const customHeaders = { "Custom-Auth": "custom-value", "X-Timestamp": "123456" };
			const strategy = new CustomAuthStrategy(() => customHeaders);
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Custom-Auth"]).toBe("custom-value");
			expect(result.headers?.["X-Timestamp"]).toBe("123456");
		});

		test("should handle async custom headers", async () => {
			const customHeaders = { "Async-Header": "async-value" };
			const strategy = new CustomAuthStrategy(async () => {
				await new Promise(resolve => setTimeout(resolve, 1));
				return customHeaders;
			});
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Async-Header"]).toBe("async-value");
		});

		test("should use default error detection", () => {
			const strategy = new CustomAuthStrategy(() => ({ "Auth": "test" }));

			const error401: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			const error403: HttpError = {
				name: "HttpError",
				message: "Forbidden",
				config: { url: "test", method: "GET" },
				status: 403
			};

			const error418: HttpError = {
				name: "HttpError",
				message: "I'm a teapot",
				config: { url: "test", method: "GET" },
				status: 418
			};

			expect(strategy.isAuthError(error401)).toBe(true);
			expect(strategy.isAuthError(error403)).toBe(true);
			expect(strategy.isAuthError(error418)).toBe(false);
		});
	});

	describe("OpaqueTokenAuthStrategy", () => {
		test("should apply opaque token", async () => {
			const strategy = new OpaqueTokenAuthStrategy(() => "opaque-token-123");
			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Authorization"]).toBe("Bearer opaque-token-123");
		});

		test("should detect auth errors", () => {
			const strategy = new OpaqueTokenAuthStrategy(() => "token");
			const error: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			expect(strategy.isAuthError(error)).toBe(true);
		});
	});

	describe("RefreshableBearerAuthStrategy", () => {
		test("should apply access token initially", async () => {
			const tokenProvider = {
				getToken: () => "initial-access-token",
				refreshToken: async () => {
					await new Promise(resolve => setTimeout(resolve, 1));
					return "new-access-token";
				}
			};
			const strategy = new RefreshRotationStrategy(tokenProvider);

			const config: HttpRequestConfig = {
				url: "https://api.example.com",
				method: "GET"
			};

			const result = await strategy.applyAuth(config);

			expect(result.headers?.["Authorization"]).toBe("Bearer new-access-token"); // Uses refreshToken() on first call
		});

		test("should handle auth errors", () => {
			const tokenProvider = {
				getToken: () => "token",
				refreshToken: () => Promise.resolve("new-token")
			};
			const strategy = new RefreshRotationStrategy(tokenProvider);

			const error: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			expect(strategy.isAuthError(error)).toBe(true);
		});
	});

	describe("Integration Tests", () => {
		test("should work with different token sources", async () => {
			// Test sync and async token providers
			const strategies = [
				new BearerAuthStrategy(() => "sync-function-token"),
				new BearerAuthStrategy(async () => {
					await new Promise(resolve => setTimeout(resolve, 1)); // Simulate async work
					return "async-function-token";
				})
			];

			const expectedTokens = [
				"Bearer sync-function-token",
				"Bearer async-function-token"
			];

			for (let i = 0; i < strategies.length; i++) {
				const config: HttpRequestConfig = {
					url: "https://api.example.com",
					method: "GET"
				};

				const result = await strategies[i]!.applyAuth(config);
				expect(result.headers?.["Authorization"]).toBe(expectedTokens[i]);
			}
		});

		test("should handle errors consistently across strategies", () => {
			const tokenProvider = {
				getToken: () => "token",
				refreshToken: () => Promise.resolve("new-token")
			};

			const strategies = [
				new BearerAuthStrategy(() => "token"),
				new ApiKeyAuthStrategy(() => "value"),
				new BasicAuthStrategy(() => ({ username: "user", password: "pass" })),
				new OpaqueTokenAuthStrategy(() => "token"),
				new RefreshableBearerAuthStrategy(tokenProvider)
			];

			const error401: HttpError = {
				name: "HttpError",
				message: "Unauthorized",
				config: { url: "test", method: "GET" },
				status: 401
			};

			const error200: HttpError = {
				name: "HttpError",
				message: "OK",
				config: { url: "test", method: "GET" },
				status: 200
			};

			strategies.forEach(strategy => {
				expect(strategy.isAuthError(error401)).toBe(true);
				expect(strategy.isAuthError(error200)).toBe(false);
			});
		});
	});
});
