import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "../src/core/HttpClient";

describe("URL Resolution", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		global.fetch = fetchMock as any;
	});

	it("should handle baseUrl with path correctly when request path starts with / (абсолютный путь)", async () => {
		// Arrange
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ users: [] })
		});

		// Act
		await client.get("/users").send();

		// Assert - теперь абсолютный путь добавляется к baseUrl, а не заменяет его
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/v1/api/users", // Путь добавляется к baseUrl
			expect.any(Object)
		);
	});

	it("should handle baseUrl with path correctly when request path is relative", async () => {
		// Arrange
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ users: [] })
		});

		// Act
		await client.get("users").send();

		// Assert - относительный путь добавляется к базовому
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/v1/api/users", // Относительный путь тоже добавляется к baseUrl
			expect.any(Object)
		);
	});

	it("should handle baseUrl ending with slash and absolute path", async () => {
		// Arrange
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api/"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ users: [] })
		});

		// Act
		await client.get("/users").send();

		// Assert
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/v1/api/users", // Путь добавляется, слеши нормализуются
			expect.any(Object)
		);
	});

	it("should handle multiple path segments", async () => {
		// Arrange
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ user: {} })
		});

		// Act
		await client.get("/admin/users/123").send();

		// Assert
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/v1/api/admin/users/123", // Полный путь добавляется к baseUrl
			expect.any(Object)
		);
	});

	it("demonstrates the FIXED bug - absolute paths now properly append to baseUrl", async () => {
		// Исправлено: теперь /users добавляется к /v1/api как ожидают разработчики
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ users: [] })
		});

		await client.get("/users").send();

		const calledUrl = fetchMock.mock.calls[0]?.[0];

		// НОВОЕ поведение - интуитивное для разработчиков
		expect(calledUrl).toBe("https://api.example.com/v1/api/users");

		console.log("Fixed URL:", calledUrl);
	});

	it("should handle full URLs correctly", async () => {
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ data: [] })
		});

		// Act - полный URL должен использоваться как есть
		await client.get("https://other-api.com/data").send();

		// Assert
		expect(fetchMock).toHaveBeenCalledWith(
			"https://other-api.com/data",
			expect.any(Object)
		);
	});

	it("should handle empty path", async () => {
		const client = new HttpClient({
			baseUrl: "https://api.example.com/v1/api"
		});

		fetchMock.mockResolvedValueOnce({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "application/json" }),
			json: () => ({ status: "ok" })
		});

		// Act - пустой путь должен возвращать baseUrl
		await client.get("").send();

		// Assert
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.example.com/v1/api",
			expect.any(Object)
		);
	});
});
