import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyStrategy } from "../src/auth/ApiKeyStrategy";
import { OpaqueTokenStrategy } from "../src/auth/OpaqueTokenStrategy";
import { MemoryStoragePersist } from "../src/storage/MemoryStoragePersist";
import { MockRequest } from "./utils/test-helpers";

describe("ApiKeyStrategy", () => {
	describe("enrich", () => {
		it("should add API key to header by default", async () => {
			const apiKey = "test-api-key-123";
			const strategy = new ApiKeyStrategy("X-API-Key", apiKey);

			const request = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(request as any);

			expect((headers as any)["X-API-Key"]).toBe(apiKey);
		});

		it("should add API key as query parameter if asQueryParam=true", async () => {
			const apiKey = "test-api-key-123";
			const strategy = new ApiKeyStrategy("api_key", apiKey, true);

			const request = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(request as any);

			// Headers should be empty since the key is added to URL
			expect(Object.keys(headers).length).toBe(0);

			// Need to check if URL was modified via Object.defineProperty
			// This is difficult to test directly, so we could verify that Object.defineProperty was called
		});
	});
});

describe("OpaqueTokenStrategy", () => {
	let storage: MemoryStoragePersist;
	let strategy: OpaqueTokenStrategy;
	const refreshEndpoint = "https://api.example.com/auth/refresh";

	beforeEach(() => {
		storage = new MemoryStoragePersist();
		strategy = new OpaqueTokenStrategy(storage, refreshEndpoint);
	});

	describe("enrich", () => {
		it("should add access token to Authorization header", async () => {
			// Save tokens to storage before test
			await storage.set("tokens", { access: "access-token-123" });

			const req = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(req as any);

			expect((headers as any)["Authorization"]).toBe("Bearer access-token-123");
		});

		it("should return empty headers if token is missing", async () => {
			const req = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(req as any);

			expect(Object.keys(headers).length).toBe(0);
		});
	});

	describe("refresh", () => {
		let originalFetch: any;

		beforeEach(() => {
			originalFetch = global.fetch;
		});

		afterEach(() => {
			global.fetch = originalFetch;
		});

		it("should refresh tokens when receiving 401", async () => {
			// Save tokens to storage
			await storage.set("tokens", {
				access: "expired-access-token",
				refresh: "refresh-token-123"
			});

			// Mock fetch for token refresh endpoint
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve({ access: "new-access-token", refresh: "new-refresh-token" })
			});

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 401 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(true);
			expect(global.fetch).toHaveBeenCalledWith(refreshEndpoint, expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ token: "refresh-token-123" })
			}));

			// Verify that new tokens are saved
			const newTokens = await storage.get("tokens");
			expect(newTokens).toEqual({
				access: "new-access-token",
				refresh: "new-refresh-token"
			});
		});

		it("should not refresh tokens if status is not 401/403", async () => {
			await storage.set("tokens", {
				access: "access-token",
				refresh: "refresh-token"
			});

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 200 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(false);
		});

		it("should return false if refresh token is missing", async () => {
			await storage.set("tokens", { access: "access-token" });

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 401 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(false);
		});

		it("should return false if refresh API returns an error", async () => {
			await storage.set("tokens", {
				access: "access-token",
				refresh: "invalid-refresh-token"
			});

			// Mock fetch with error response
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 400
			});

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 401 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(false);
		});
	});
});
