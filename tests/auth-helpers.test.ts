import { describe, expect, it } from "vitest";

import { apiKeyAuth, basicAuth, bearerAuth, refreshAuth } from "../src/auth/helpers";

describe("Auth Helpers", () => {
	describe("bearerAuth", () => {
		it("should create bearer auth with static token", async () => {
			const auth = bearerAuth("my-token");
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			expect(headers).toEqual({ Authorization: "Bearer my-token" });
		});

		it("should create bearer auth with dynamic token", async () => {
			let token = "initial";
			const auth = bearerAuth(() => token);

			const headers1 = await auth.enrichRequest(new Request("https://api.test.com"));
			expect(headers1).toEqual({ Authorization: "Bearer initial" });

			token = "updated";
			const headers2 = await auth.enrichRequest(new Request("https://api.test.com"));
			expect(headers2).toEqual({ Authorization: "Bearer updated" });
		});

		it("should support async token getter", async () => {
			const auth = bearerAuth(() => Promise.resolve("async-token"));
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			expect(headers).toEqual({ Authorization: "Bearer async-token" });
		});
	});

	describe("apiKeyAuth", () => {
		it("should create API key auth with custom header", async () => {
			const auth = apiKeyAuth("my-key", "X-Custom-Key");
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			expect(headers).toEqual({ "X-Custom-Key": "my-key" });
		});

		it("should use default header name", async () => {
			const auth = apiKeyAuth("my-key");
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			expect(headers).toEqual({ "X-API-Key": "my-key" });
		});

		it("should support dynamic key", async () => {
			let key = "key-1";
			const auth = apiKeyAuth(() => key);

			const headers1 = await auth.enrichRequest(new Request("https://api.test.com"));
			expect(headers1).toEqual({ "X-API-Key": "key-1" });

			key = "key-2";
			const headers2 = await auth.enrichRequest(new Request("https://api.test.com"));
			expect(headers2).toEqual({ "X-API-Key": "key-2" });
		});
	});

	describe("basicAuth", () => {
		it("should create basic auth", async () => {
			const auth = basicAuth("user", "pass");
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			// Base64 of 'user:pass'
			const expected = "Basic " + btoa("user:pass");
			expect(headers).toEqual({ Authorization: expected });
		});

		it("should handle special characters", async () => {
			const auth = basicAuth("user@email.com", "p@ss:word!");
			const headers = await auth.enrichRequest(new Request("https://api.test.com"));

			const expected = "Basic " + btoa("user@email.com:p@ss:word!");
			expect(headers).toEqual({ Authorization: expected });
		});
	});

	describe("refreshAuth", () => {
		it("should add bearer token to requests", async () => {
			const auth = refreshAuth({
				getToken: () => "access-token",
				getRefreshToken: () => "refresh-token",
				refresh: () => Promise.resolve("new-token"),
			});

			const headers = await auth.enrichRequest(new Request("https://api.test.com"));
			expect(headers).toEqual({ Authorization: "Bearer access-token" });
		});

		it("should refresh token on 401", async () => {
			let currentToken = "old-token";
			const auth = refreshAuth({
				getToken: () => currentToken,
				getRefreshToken: () => "refresh-token",
				refresh: () => {
					currentToken = "new-token";
					return Promise.resolve(currentToken);
				},
			});

			// Simulate 401 response
			const response = new Response(null, { status: 401 });
			const shouldRetry = await auth.handleRequestError?.(
				new Request("https://api.test.com"),
				response
			);

			expect(shouldRetry).toBe(true);
			expect(currentToken).toBe("new-token");
		});

		it("should not refresh on non-401 errors", async () => {
			let refreshCalled = false;
			const auth = refreshAuth({
				getToken: () => "token",
				getRefreshToken: () => "refresh",
				refresh: () => {
					refreshCalled = true;
					return Promise.resolve("new");
				},
			});

			const response = new Response(null, { status: 500 });
			const shouldRetry = await auth.handleRequestError?.(
				new Request("https://api.test.com"),
				response
			);

			expect(shouldRetry).toBe(false);
			expect(refreshCalled).toBe(false);
		});

		it("should use custom shouldRefresh function", async () => {
			let refreshCalled = false;
			const auth = refreshAuth({
				getToken: () => "token",
				getRefreshToken: () => "refresh",
				refresh: () => {
					refreshCalled = true;
					return Promise.resolve("new");
				},
				shouldRefresh: (res) => res.status === 403,
			});

			// Should not refresh on 401 with custom shouldRefresh
			const response401 = new Response(null, { status: 401 });
			await auth.handleRequestError?.(new Request("https://api.test.com"), response401);
			expect(refreshCalled).toBe(false);

			// Should refresh on 403 with custom shouldRefresh
			const response403 = new Response(null, { status: 403 });
			await auth.handleRequestError?.(new Request("https://api.test.com"), response403);
			expect(refreshCalled).toBe(true);
		});
	});
});
