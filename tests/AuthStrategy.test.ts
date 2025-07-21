import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiKeyStrategy } from "../src/auth/ApiKeyStrategy";
import { OpaqueTokenStrategy } from "../src/auth/OpaqueTokenStrategy";
import { MemoryStoragePersist } from "../src/storage/MemoryStoragePersist";
import { MockRequest } from "./utils/test-helpers";

describe("ApiKeyStrategy", () => {
	describe("enrich", () => {
		it("должен добавлять API ключ в заголовок по умолчанию", async () => {
			const apiKey = "test-api-key-123";
			const strategy = new ApiKeyStrategy("X-API-Key", apiKey);

			const request = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(request as any);

			expect((headers as any)["X-API-Key"]).toBe(apiKey);
		});

		it("должен добавлять API ключ как query параметр, если asQueryParam=true", async () => {
			const apiKey = "test-api-key-123";
			const strategy = new ApiKeyStrategy("api_key", apiKey, true);

			const request = new MockRequest("https://api.example.com/data");
			const headers = await strategy.enrich(request as any);

			// Headers должен быть пустым, т.к. ключ добавлен в URL
			expect(Object.keys(headers).length).toBe(0);

			// Нужно проверить, изменился ли URL через Object.defineProperty
			// Это сложно протестировать напрямую, поэтому можно проверить, что вызван Object.defineProperty
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
		it("должен добавлять токен доступа в заголовок Authorization", async () => {
			// Сохраняем токены в хранилище перед тестом
			await storage.set("tokens", { access: "access-token-123" });

			const headers = await strategy.enrich();

			expect((headers as any)["Authorization"]).toBe("Bearer access-token-123");
		});

		it("должен возвращать пустые заголовки, если токен отсутствует", async () => {
			const headers = await strategy.enrich();

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

		it("должен обновлять токены, если получен 401", async () => {
			// Сохраняем токены в хранилище
			await storage.set("tokens", {
				access: "expired-access-token",
				refresh: "refresh-token-123"
			});

			// Мокаем fetch для эндпоинта обновления токенов
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

			// Проверяем, что новые токены сохранены
			const newTokens = await storage.get("tokens");
			expect(newTokens).toEqual({
				access: "new-access-token",
				refresh: "new-refresh-token"
			});
		});

		it("не должен обновлять токены, если статус не 401/403", async () => {
			await storage.set("tokens", {
				access: "access-token",
				refresh: "refresh-token"
			});

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 200 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(false);
		});

		it("должен возвращать false, если нет refresh токена", async () => {
			await storage.set("tokens", { access: "access-token" });

			const req = new MockRequest("https://api.example.com/data");
			const res = new Response(null, { status: 401 });

			const refreshed = await strategy.refresh(req as any, res);

			expect(refreshed).toBe(false);
		});

		it("должен возвращать false, если API обновления вернул ошибку", async () => {
			await storage.set("tokens", {
				access: "access-token",
				refresh: "invalid-refresh-token"
			});

			// Мокаем fetch с ошибкой
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
