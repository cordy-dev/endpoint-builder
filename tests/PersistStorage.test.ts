import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStoragePersist } from "../src/storage/LocalStoragePersist";
import { MemoryStoragePersist } from "../src/storage/MemoryStoragePersist";
import { mockLocalStorage } from "./utils/test-helpers";

describe("LocalStoragePersist", () => {
	const mockLS = mockLocalStorage();

	beforeEach(() => {
		// Подменяем глобальный localStorage на наш мок
		Object.defineProperty(global, "localStorage", {
			value: mockLS,
			writable: true
		});
		// Сбрасываем счетчики вызовов моков перед каждым тестом
		vi.resetAllMocks();
	});

	describe("get", () => {
		it("должен возвращать данные из localStorage", async () => {
			const storage = new LocalStoragePersist();
			const testData = { id: 1, name: "Test" };

			// Мокаем получение данных
			mockLS.getItem.mockReturnValue(JSON.stringify(testData));

			const result = await storage.get("test-key");

			expect(result).toEqual(testData);
			expect(mockLS.getItem).toHaveBeenCalledWith("test-key");
		});

		it("должен возвращать undefined для несуществующего ключа", async () => {
			const storage = new LocalStoragePersist();

			// Мокаем отсутствие данных
			mockLS.getItem.mockReturnValue(null);

			const result = await storage.get("non-existent-key");

			expect(result).toBeUndefined();
			expect(mockLS.getItem).toHaveBeenCalledWith("non-existent-key");
		});

		it("должен возвращать undefined при ошибке парсинга JSON", async () => {
			const storage = new LocalStoragePersist();

			// Мокаем невалидный JSON
			mockLS.getItem.mockReturnValue("invalid json");

			const result = await storage.get("invalid-json");

			expect(result).toBeUndefined();
			expect(mockLS.getItem).toHaveBeenCalledWith("invalid-json");
		});
	});

	describe("set", () => {
		it("должен сохранять данные в localStorage", async () => {
			const storage = new LocalStoragePersist();
			const testData = { id: 1, name: "Test" };

			await storage.set("test-key", testData);

			expect(mockLS.setItem).toHaveBeenCalledWith("test-key", JSON.stringify(testData));
		});
	});

	describe("delete", () => {
		it("должен удалять данные из localStorage", async () => {
			const storage = new LocalStoragePersist();

			await storage.delete("test-key");

			expect(mockLS.removeItem).toHaveBeenCalledWith("test-key");
		});
	});
});

describe("MemoryStoragePersist", () => {
	describe("get/set/delete", () => {
		it("должен сохранять и получать данные из памяти", async () => {
			const storage = new MemoryStoragePersist();
			const testData = { id: 1, name: "Test" };

			// Сначала проверяем, что данных нет
			expect(await storage.get("test-key")).toBeUndefined();

			// Сохраняем данные
			await storage.set("test-key", testData);

			// Проверяем, что данные сохранились
			expect(await storage.get("test-key")).toEqual(testData);

			// Удаляем данные
			await storage.delete("test-key");

			// Проверяем, что данные удалились
			expect(await storage.get("test-key")).toBeUndefined();
		});

		it("должен возвращать undefined для невалидного JSON", async () => {
			const storage = new MemoryStoragePersist();

			// Напрямую устанавливаем невалидный JSON в Map
			(storage as any).storage.set("invalid-json", "{invalid}");

			const result = await storage.get("invalid-json");

			expect(result).toBeUndefined();
		});
	});
});
