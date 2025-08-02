import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiKeyStrategy } from "../src/auth/ApiKeyStrategy";
import { HttpClient } from "../src/core/HttpClient";
import { ExponentialRetryStrategy } from "../src/retry/ExponentialRetryStrategy";
import { MemoryStoragePersist } from "../src/storage/MemoryStoragePersist";
import { mockFetch } from "./utils/test-helpers";

describe("Integration tests for endpoint-builder", () => {
	// Save original fetch for restoration after tests
	const originalFetch = global.fetch;

	afterEach(() => {
		// Восстанавливаем оригинальный fetch после каждого теста
		global.fetch = originalFetch;
		vi.resetAllMocks();
	});

	   describe("Complete usage example", () => {
		it("должен создавать запрос с аутентификацией, выполнять его и обрабатывать ответ", async () => {
			// Мокаем ответ сервера
			const mockResponse = {
				id: 1,
				name: "User Name",
				email: "user@example.com"
			};
			global.fetch = mockFetch(mockResponse, 200, { "Content-Type": "application/json" });

			// Создаем хранилище
			const storage = new MemoryStoragePersist();

			// Создаем стратегию аутентификации
			const authStrategy = new ApiKeyStrategy("X-API-Key", "test-api-key-12345");

			// Создаем стратегию повторных попыток с максимум 2 попытками
			const retryStrategy = new ExponentialRetryStrategy(2, 100, 1000);

			// Создаем HTTP клиент со всеми настройками
			const client = new HttpClient({
				baseUrl: "https://api.example.com",
				auth: authStrategy as any,
				storage,
				defaultHeaders: {
					"Accept": "application/json",
					"X-Client-Version": "1.0"
				},
				dedupe: true,
				retryStrategy
			});

			// Выполняем GET запрос с параметрами
			const user = await client
				.get<typeof mockResponse>("/users/1")
				.query({ fields: "id,name,email" })
				.header("X-Custom-Header", "custom-value")
				.data();

			// Проверяем результат
			expect(user).toEqual(mockResponse);

			// Проверяем правильность вызова fetch
			expect(global.fetch).toHaveBeenCalledTimes(1);
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users/1?fields=id%2Cname%2Cemail",
				expect.objectContaining({
					method: "GET",
					headers: expect.objectContaining({
						"Accept": "application/json",
						"X-Client-Version": "1.0",
						"X-API-Key": "test-api-key-12345",
						"X-Custom-Header": "custom-value"
					})
				})
			);
		});

		it("должен отправлять POST запрос с JSON телом", async () => {
			// Мокаем ответ сервера
			const mockResponse = { success: true, id: 123 };
			global.fetch = mockFetch(mockResponse, 201);

			const client = new HttpClient({ baseUrl: "https://api.example.com" });

			// Данные для отправки
			const newUser = {
				name: "New User",
				email: "newuser@example.com",
				role: "user"
			};

			// Выполняем POST запрос с JSON телом
			const result = await client
				.post<typeof mockResponse, typeof newUser>("/users")
				.json(newUser)
				.data();

			// Проверяем результат
			expect(result).toEqual(mockResponse);

			// Проверяем правильность вызова fetch
			expect(global.fetch).toHaveBeenCalledWith(
				"https://api.example.com/users",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json"
					}),
					body: JSON.stringify(newUser)
				})
			);
		});

		it("должен выполнять повторные попытки при ошибке сервера", async () => {
			// Мокаем ответы: сначала ошибка 500, затем успешный ответ
			global.fetch = vi.fn()
				.mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
				.mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" }
				}));

			// Создаем HTTP клиент с настроенной стратегией повторных попыток
			const client = new HttpClient({
				baseUrl: "https://api.example.com",
				retryStrategy: new ExponentialRetryStrategy(3, 1) // Маленькая задержка для тестов
			});

			// Выполняем запрос
			const result = await client.get("/api/resource").data();

			// Проверяем результат
			expect(result).toEqual({ success: true });

			// Проверяем, что fetch был вызван дважды (первый раз ошибка, второй раз успех)
			expect(global.fetch).toHaveBeenCalledTimes(2);
		});

		it("должен дедуплицировать идентичные запросы", async () => {
			// Мокаем ответ сервера
			const mockResponse = { data: "test" };
			global.fetch = mockFetch(mockResponse);

			// Создаем HTTP клиент с включенной дедупликацией
			const client = new HttpClient({
				baseUrl: "https://api.example.com",
				dedupe: true
			});

			// Выполняем два одинаковых запроса параллельно
			const promise1 = client.get("/api/data").data();
			const promise2 = client.get("/api/data").data();

			// Получаем результаты
			const [result1, result2] = await Promise.all([promise1, promise2]);

			// Проверяем результаты
			expect(result1).toEqual(mockResponse);
			expect(result2).toEqual(mockResponse);

			// Проверяем, что fetch был вызван только один раз
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});
	});
});
