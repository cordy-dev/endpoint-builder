import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";
import { RequestBuilder } from "../src/core/RequestBuilder";
import { mockFetch } from "./utils/test-helpers";

describe("RequestBuilder", () => {
	// Сохраняем оригинальный fetch
	const originalFetch = global.fetch;
	let client: HttpClient;

	beforeEach(() => {
		// Создаем новый клиент для каждого теста
		client = new HttpClient({ baseUrl: "https://api.example.com" });
		// Очищаем моки перед каждым тестом
		vi.resetAllMocks();
	});

	afterEach(() => {
		// Восстанавливаем оригинальный fetch после каждого теста
		global.fetch = originalFetch;
	});

	describe("метод метод", () => {
		it("должен устанавливать HTTP метод", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.method("POST");

			expect(builder._method).toBe("POST");
		});
	});

	describe("метод query", () => {
		it("должен устанавливать query параметры", () => {
			const builder = new RequestBuilder(client, "/users");
			const query = { page: 1, limit: 10, filter: "active" };

			builder.query(query);

			expect(builder._query).toEqual(query);
		});
	});

	describe("методы headers и header", () => {
		it("должен устанавливать несколько заголовков через объект", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.headers({
				"Content-Type": "application/json",
				"X-API-Key": "test-api-key"
			});

			expect(builder._headers["Content-Type"]).toBe("application/json");
			expect(builder._headers["X-API-Key"]).toBe("test-api-key");
		});

		it("должен устанавливать отдельный заголовок", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.header("Authorization", "Bearer token123");

			expect(builder._headers["Authorization"]).toBe("Bearer token123");
		});

		it("должен объединять заголовки при нескольких вызовах", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.headers({ "Content-Type": "application/json" });
			builder.header("X-API-Key", "test-api-key");

			expect(builder._headers["Content-Type"]).toBe("application/json");
			expect(builder._headers["X-API-Key"]).toBe("test-api-key");
		});
	});

	describe("метод responseType", () => {
		it("должен устанавливать тип ответа", () => {
			const builder = new RequestBuilder(client, "/images/1");

			builder.responseType("blob");

			expect(builder._responseType).toBe("blob");
		});
	});

	describe("метод body", () => {
		it("должен устанавливать тело запроса", () => {
			const builder = new RequestBuilder(client, "/users");
			const body = { name: "John", email: "john@example.com" };

			builder.body(body);

			expect(builder._body).toEqual(body);
		});
	});

	describe("метод json", () => {
		it("должен устанавливать тело запроса и заголовок Content-Type: application/json", () => {
			const builder = new RequestBuilder(client, "/users");
			const body = { name: "John", email: "john@example.com" };

			builder.json(body);

			expect(builder._body).toEqual(body);
			expect(builder._headers["Content-Type"]).toBe("application/json");
		});
	});

	describe("метод form", () => {
		it("должен устанавливать FormData как тело запроса", () => {
			const builder = new RequestBuilder(client, "/users");
			const formData = new FormData();
			formData.append("name", "John");
			formData.append("email", "john@example.com");

			builder.form(formData, false);

			expect(builder._body).toBe(formData);
			expect(builder._headers["Content-Type"]).toBe("multipart/form-data");
		});

		it("должен преобразовывать объект в FormData", () => {
			const builder = new RequestBuilder(client, "/users");
			const data = { name: "John", email: "john@example.com" };

			builder.form(data);

			expect(builder._body).toBeInstanceOf(FormData);
			expect(builder._headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
		});

		it("должен игнорировать null и undefined значения при создании FormData", () => {
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

	describe("метод auth", () => {
		it("должен устанавливать стратегию аутентификации", () => {
			const builder = new RequestBuilder(client, "/users");
			const authStrategy = {
				enrich: vi.fn().mockResolvedValue({ Authorization: "Bearer token123" })
			};

			builder.auth(authStrategy);

			expect(builder._auth).toBe(authStrategy);
		});

		it("должен позволять отключать аутентификацию для запроса", () => {
			const builder = new RequestBuilder(client, "/public/data");

			builder.auth(null);

			expect(builder._auth).toBeNull();
		});
	});

	describe("метод dedupe", () => {
		it("должен включать или выключать дедупликацию запросов", () => {
			const builder = new RequestBuilder(client, "/users");

			// По умолчанию должен быть равен значению из HttpClient
			expect(builder._dedupe).toBe(false);

			builder.dedupe(true);
			expect(builder._dedupe).toBe(true);

			builder.dedupe(false);
			expect(builder._dedupe).toBe(false);
		});
	});

	describe("метод mock", () => {
		it("должен создавать новый HttpClient с включенным режимом mock", () => {
			const builder = new RequestBuilder(client, "/users");
			const mockedBuilder = builder.mock();

			// Проверяем, что у нового билдера другой клиент с включенным mock
			expect(mockedBuilder).not.toBe(builder);
			expect((mockedBuilder as any).client.defaults.mock).toBe(true);
		});
	});

	describe("метод data", () => {
		it("должен выполнять запрос и возвращать только данные", async () => {
			// Мокаем fetch
			const mockResponseData = { id: 1, name: "Test User" };
			global.fetch = mockFetch(mockResponseData);

			const builder = new RequestBuilder(client, "/users/1").method("GET");
			const result = await builder.data();

			expect(result).toEqual(mockResponseData);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("метод send", () => {
		it("должен выполнять запрос и возвращать полный ответ", async () => {
			// Мокаем fetch
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

	describe("метод timeout", () => {
		it("должен устанавливать таймаут для запроса", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.timeout(5000);

			expect(builder._timeout).toBe(5000);
		});
	});

	describe("метод signal", () => {
		it("должен устанавливать AbortSignal для запроса", () => {
			const builder = new RequestBuilder(client, "/users");
			const controller = new AbortController();

			builder.signal(controller.signal);

			expect(builder._signal).toBe(controller.signal);
		});
	});

	describe("метод retry", () => {
		it("должен устанавливать стратегию повторных попыток", () => {
			const builder = new RequestBuilder(client, "/users");
			const retryStrategy = {
				shouldRetry: vi.fn().mockReturnValue(true),
				nextDelay: vi.fn().mockReturnValue(1000)
			};

			builder.retry(retryStrategy);

			expect(builder._retry).toBe(retryStrategy);
		});

		it("должен позволять отключать повторные попытки", () => {
			const builder = new RequestBuilder(client, "/users");

			builder.retry(null);

			expect(builder._retry).toBeNull();
		});
	});

	describe("цепочка вызовов", () => {
		it("должен поддерживать цепочку вызовов методов", async () => {
			// Мокаем fetch
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
