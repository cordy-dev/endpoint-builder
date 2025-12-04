import { describe, expect, it } from "vitest";

import { decodeResponse } from "../src/utils/decodeResponse";
import { mergeHeaders } from "../src/utils/mergeHeaders";
import { serializeBody } from "../src/utils/serializeBody";
import { toQuery } from "../src/utils/toQuery";

describe("mergeHeaders", () => {
	it("должен объединять объекты заголовков", () => {
		const h1 = { "Content-Type": "application/json" };
		const h2 = { Authorization: "Bearer token" };

		const result = mergeHeaders(h1, h2);

		expect(result).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer token"
		});
	});

	it("должен правильно обрабатывать пустые объекты", () => {
		const h1 = { "Content-Type": "application/json" };

		const result = mergeHeaders(h1, {});

		expect(result).toEqual(h1);
	});

	it("должен перезаписывать заголовки из второго объекта", () => {
		const h1 = { "Content-Type": "application/json" };
		const h2 = { "Content-Type": "text/plain" };

		const result = mergeHeaders(h1, h2);

		expect(result).toEqual({
			"Content-Type": "text/plain"
		});
	});
});

describe("toQuery", () => {
	it("должен преобразовывать объект в строку запроса", () => {
		const params = {
			page: 1,
			limit: 10,
			filter: "active"
		};

		const result = toQuery(params);

		expect(result).toBe("page=1&limit=10&filter=active");
	});

	it("должен корректно обрабатывать пустой объект", () => {
		const result = toQuery({});

		expect(result).toBe("");
	});

	it("должен пропускать undefined значения", () => {
		const params = {
			page: 1,
			filter: undefined,
			sort: "name"
		};

		const result = toQuery(params);

		expect(result).toBe("page=1&sort=name");
	});

	it("должен правильно кодировать специальные символы", () => {
		const params = {
			q: "search term & with spaces",
			tag: "#special"
		};

		const result = toQuery(params);

		// Проверяем, что символы правильно закодированы
		expect(result).toBe("q=search%20term%20%26%20with%20spaces&tag=%23special");
	});

	it("должен корректно обрабатывать массивы", () => {
		const params = {
			ids: [1, 2, 3, 4],
			page: 1
		};

		const result = toQuery(params);

		// Массивы должны быть представлены как повторяющиеся параметры
		expect(result).toBe("ids=1&ids=2&ids=3&ids=4&page=1");
	});

	it("должен пропускать null и undefined элементы в массиве", () => {
		const params = {
			ids: [1, null, 2, undefined, 3],
			active: true
		};

		const result = toQuery(params);

		expect(result).toBe("ids=1&ids=2&ids=3&active=true");
	});

	it("должен корректно обрабатывать пустой массив", () => {
		const params = {
			ids: [],
			page: 1
		};

		const result = toQuery(params);

		expect(result).toBe("page=1");
	});

	it("должен корректно обрабатывать массивы строк", () => {
		const params = {
			tags: ["javascript", "typescript", "node.js"],
			status: "active"
		};

		const result = toQuery(params);

		expect(result).toBe("tags=javascript&tags=typescript&tags=node.js&status=active");
	});
});

describe("serializeBody", () => {
	it("должен возвращать undefined для null/undefined", () => {
		expect(serializeBody(null, {})).toBeUndefined();
		expect(serializeBody(undefined, {})).toBeUndefined();
	});

	it("должен конвертировать объект в JSON строку для application/json", () => {
		const body = { name: "Test", value: 123 };
		const headers = { "Content-Type": "application/json" };

		const result = serializeBody(body, headers);

		expect(result).toBe(JSON.stringify(body));
	});

	it("не должен преобразовывать FormData", () => {
		const formData = new FormData();
		formData.append("name", "Test");

		const headers = { "Content-Type": "multipart/form-data" };
		const result = serializeBody(formData, headers);

		expect(result).toBe(formData);
	});

	it("не должен преобразовывать Blob", () => {
		const blob = new Blob(["test"], { type: "text/plain" });
		const headers = {};
		const result = serializeBody(blob, headers);

		expect(result).toBe(blob);
	});

	it("не должен преобразовывать строку", () => {
		const body = "test string";
		const headers = {};
		const result = serializeBody(body, headers);

		expect(result).toBe(body);
	});
});

// Для тестирования decodeResponse нужно создать моки Response с разными типами данных
describe("decodeResponse", () => {
	it("должен декодировать JSON ответ", async () => {
		const data = { id: 1, name: "Test" };
		const response = new Response(JSON.stringify(data), {
			headers: { "Content-Type": "application/json" }
		});

		const result = await decodeResponse(response, { url: "https://example.com", method: "GET" });

		expect(result).toEqual(data);
	});

	it("должен декодировать текстовый ответ", async () => {
		const text = "Hello, world!";
		const response = new Response(text, {
			headers: { "Content-Type": "text/plain" }
		});

		const result = await decodeResponse(response, { url: "https://example.com", method: "GET", responseType: "text" });

		expect(result).toBe(text);
	});

	it("должен декодировать ответ как Blob", async () => {
		const blob = new Blob(["test binary data"], { type: "application/octet-stream" });
		const response = new Response(blob);

		const result = await decodeResponse(response, { url: "https://example.com", method: "GET", responseType: "blob" });

		expect(result).toBeInstanceOf(Blob);
	});

	it("должен декодировать пустой ответ", async () => {
		const response = new Response(null, { status: 204 });

		const result = await decodeResponse(response, { url: "https://example.com", method: "GET" });

		expect(result).toBeUndefined();
	});
});
