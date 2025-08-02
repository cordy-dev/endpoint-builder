import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";
import { MemoryStoragePersist } from "../src/storage/MemoryStoragePersist";
import { mockFetch } from "./utils/test-helpers";

describe("HttpClient", () => {
	// Сохраняем оригинальный fetch
	const originalFetch = global.fetch;

	beforeEach(() => {
		// Очищаем моки перед каждым тестом
		vi.resetAllMocks();
	});

	afterEach(() => {
		// Восстанавливаем оригинальный fetch после каждого теста
		global.fetch = originalFetch;
	});

	describe("constructor", () => {
		it("должен создаваться с дефолтными параметрами", () => {
			const client = new HttpClient();

			expect(client).toBeInstanceOf(HttpClient);
			expect(client.defaults.baseUrl).toBe("");
			expect(client.defaults.auth).toBeNull();
			expect(client.defaults.dedupe).toBe(false);
		});

		it("должен применять пользовательские параметры", () => {
			const storage = new MemoryStoragePersist();
			const client = new HttpClient({
				baseUrl: "https://api.example.com",
				dedupe: true,
				storage
			});

			expect(client.defaults.baseUrl).toBe("https://api.example.com");
			expect(client.defaults.dedupe).toBe(true);
			expect(client.defaults.storage).toBe(storage);
		});
	});

	describe("HTTP request methods", () => {
		it("должен создавать GET запрос", () => {
			const client = new HttpClient();
			const builder = client.get("/users");

			expect(builder._method).toBe("GET");
		});

		it("должен создавать POST запрос", () => {
			const client = new HttpClient();
			const builder = client.post("/users");

			expect(builder._method).toBe("POST");
		});

		it("должен создавать PUT запрос", () => {
			const client = new HttpClient();
			const builder = client.put("/users/1");

			expect(builder._method).toBe("PUT");
		});

		it("должен создавать PATCH запрос", () => {
			const client = new HttpClient();
			const builder = client.patch("/users/1");

			expect(builder._method).toBe("PATCH");
		});

		it("должен создавать DELETE запрос", () => {
			const client = new HttpClient();
			const builder = client.delete("/users/1");

			expect(builder._method).toBe("DELETE");
		});
	});

	describe("_execute", () => {
		it("должен выполнять HTTP запрос и возвращать данные", async () => {
			// Мокаем fetch
			const mockResponse = { id: 1, name: "Test User" };
			global.fetch = mockFetch(mockResponse, 200, { "Content-Type": "application/json" });

			const client = new HttpClient({ baseUrl: "https://api.example.com" });
			const response = await client.get("/users/1").send();

			// Проверяем результат
			expect(response.status).toBe(200);
			expect(response.data).toEqual(mockResponse);

			// Проверяем, что fetch был вызван с правильными параметрами
			expect(global.fetch).toHaveBeenCalledTimes(1);
			expect(global.fetch).toHaveBeenCalledWith("https://api.example.com/users/1", expect.objectContaining({
				method: "GET",
				headers: expect.any(Object),
			}));
		});

		it("должен обрабатывать ошибки HTTP запросов", async () => {
			// Мокаем fetch с ошибкой
			global.fetch = mockFetch({ message: "Not Found" }, 404);

			const client = new HttpClient();

			try {
				await client.get("/users/999").send();
				// Если не выбросит ошибку, тест должен провалиться
				expect(true).toBe(false);
			} catch (err: any) {
				expect(err.status).toBe(404);
				expect(err.response.status).toBe(404);
			}
		});

		it("должен дедуплицировать одинаковые запросы при включенной дедупликации", async () => {
			// Мокаем fetch
			global.fetch = mockFetch({ id: 1 });

			const client = new HttpClient({ dedupe: true });

			// Отправляем два одинаковых запроса одновременно
			const promise1 = client.get("/api/resource").send();
			const promise2 = client.get("/api/resource").send();

			// Проверяем, что оба промиса возвращают одинаковые данные
			const [result1, result2] = await Promise.all([promise1, promise2]);
			expect(result1).toEqual(result2);

			// Проверяем, что fetch был вызван только один раз
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		it("должен использовать правильный baseUrl", async () => {
			// Мокаем fetch
			global.fetch = mockFetch({});

			const client = new HttpClient({ baseUrl: "https://api.example.com" });
			await client.get("/users").send();

			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.anything()
			);
		});

		it("должен обрабатывать абсолютные URL, даже если baseUrl задан", async () => {
			// Мокаем fetch
			global.fetch = mockFetch({});

			const client = new HttpClient({ baseUrl: "https://api.example.com" });
			await client.get("https://other-api.example.org/data").send();

			expect(global.fetch).toHaveBeenCalledWith(
				"https://other-api.example.org/data",
				expect.anything()
			);
		});
	});

	describe("_buildConfig", () => {
		it("должен корректно объединять базовый URL и путь", async () => {
			const client = new HttpClient({ baseUrl: "https://api.example.com" });
			const builder = client.get("/users");

			// Используем приватный метод через any для тестирования
			const config = await (client as any)._buildConfig(builder);

			expect(config.url).toBe("https://api.example.com/users");
			expect(config.method).toBe("GET");
		});

		it("должен добавлять query параметры в URL", async () => {
			const client = new HttpClient({ baseUrl: "https://api.example.com" });
			const builder = client.get("/users").query({ page: 1, limit: 10 });

			const config = await (client as any)._buildConfig(builder);

			// URL должен содержать query параметры
			expect(config.url).toBe("https://api.example.com/users?page=1&limit=10");
		});

		it("должен объединять заголовки из разных источников", async () => {
			const client = new HttpClient({
				baseUrl: "https://api.example.com",
				defaultHeaders: { "X-API-Version": "1.0" }
			});

			const builder = client.get("/users").headers({ "Content-Type": "application/json" });

			const config = await (client as any)._buildConfig(builder);

			expect(config.headers["X-API-Version"]).toBe("1.0");
			expect(config.headers["Content-Type"]).toBe("application/json");
		});
	});
});
