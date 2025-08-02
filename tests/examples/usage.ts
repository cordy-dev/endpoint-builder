/**
 * В этом файле представлены примеры использования библиотеки endpoint-builder
 * для наиболее распространенных сценариев.
 */

import { ApiKeyStrategy } from "../../src/auth/ApiKeyStrategy";
import { OpaqueTokenStrategy } from "../../src/auth/OpaqueTokenStrategy";
import { HttpClient } from "../../src/core/HttpClient";
import { ExponentialRetryStrategy } from "../../src/retry/ExponentialRetryStrategy";
import { LocalStoragePersist } from "../../src/storage/LocalStoragePersist";
import { MemoryStoragePersist } from "../../src/storage/MemoryStoragePersist";

/**
 * Пример 1: Базовое использование
 */
export async function basicUsage() {
	// Создаем HTTP клиент с базовым URL
	const client = new HttpClient({
		baseUrl: "https://api.example.com"
	});

	// GET запрос
	const user = await client
		.get("/users/1")
		.data();

	// POST запрос с JSON телом
	const newUser = await client
		.post("/users")
		.json({ name: "John", email: "john@example.com" })
		.data();

	// PUT запрос с заголовками
	const updatedUser = await client
		.put("/users/1")
		.json({ name: "John Updated" })
		.header("X-Custom-Header", "value")
		.data();

	// DELETE запрос
	const deleted = await client
		.delete("/users/1")
		.data();

	// GET запрос с query параметрами
	const searchResults = await client
		.get("/users")
		.query({ search: "john", page: 1, limit: 10 })
		.data();
}

/**
 * Пример 2: Аутентификация с API ключом
 */
export async function apiKeyAuthentication() {
	// Создаем стратегию аутентификации с API ключом
	const apiKeyAuth = new ApiKeyStrategy("X-API-Key", "your-api-key-123");

	// Создаем HTTP клиент с аутентификацией
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		auth: apiKeyAuth as any
	});

	// Теперь все запросы будут автоматически включать заголовок X-API-Key
	const data = await client
		.get("/protected-resource")
		.data();
}

/**
 * Пример 3: Аутентификация с токеном доступа и обновлением
 */
export async function tokenAuthentication() {
	// Создаем хранилище для токенов
	const storage = new LocalStoragePersist();

	// Сохраняем начальные токены (обычно получаются после входа пользователя)
	await storage.set("tokens", {
		access: "initial-access-token-123",
		refresh: "refresh-token-456"
	});

	// Создаем стратегию аутентификации с токеном
	const tokenAuth = new OpaqueTokenStrategy(
		storage,
		"https://api.example.com/auth/refresh"
	);

	// Создаем HTTP клиент с аутентификацией
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		auth: tokenAuth as any
	});

	// Запросы будут автоматически включать токен и обновлять его при необходимости
	const data = await client
		.get("/protected-resource")
		.data();
}

/**
 * Пример 4: Обработка ошибок
 */
export async function errorHandling() {
	const client = new HttpClient({
		baseUrl: "https://api.example.com"
	});

	try {
		const data = await client
			.get("/resource-that-might-fail")
			.data();

		// Обработка успешного ответа
		console.log("Success:", data);
	} catch (error: any) {
		// Обработка ошибок
		if (error.status === 404) {
			console.error("Resource not found");
		} else if (error.status === 401) {
			console.error("Unauthorized");
		} else if (error.status >= 500) {
			console.error("Server error:", error.statusText);
		} else {
			console.error("Request failed:", error);
		}
	}
}

/**
 * Пример 5: Повторные попытки при ошибках
 */
export async function retryStrategy() {
	// Создаем стратегию повторных попыток
	const retry = new ExponentialRetryStrategy(
		3,      // максимум 3 попытки
		500,    // базовая задержка 500 мс
		10000   // максимальная задержка 10 секунд
	);

	// Создаем HTTP клиент со стратегией повторных попыток
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		retryStrategy: retry
	});

	// При ошибках 5xx или сетевых проблемах запрос будет повторяться автоматически
	const data = await client
		.get("/resource-that-might-fail")
		.data();
}

/**
 * Пример 6: Загрузка файлов с FormData
 */
export async function fileUpload() {
	const client = new HttpClient({
		baseUrl: "https://api.example.com"
	});

	// Создаем FormData с файлом
	const formData = new FormData();
	formData.append("file", new File(["file content"], "file.txt"));
	formData.append("description", "File description");

	// Отправляем файл
	const result = await client
		.post("/upload")
		.form(formData, false) // false означает использование multipart/form-data вместо x-www-form-urlencoded
		.data();
}

/**
 * Пример 7: Полный пример с разными типами запросов и обработкой ответов
 */
export async function completeExample() {
	// Используем MemoryStoragePersist для хранения токенов
	const storage = new MemoryStoragePersist();

	// Создаем стратегию аутентификации
	const auth = new OpaqueTokenStrategy(
		storage,
		"https://api.example.com/auth/refresh"
	);

	// Настраиваем стратегию повторных попыток
	const retry = new ExponentialRetryStrategy(3);

	// Создаем HTTP клиент со всеми настройками
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		auth: auth as any,
		storage,
		defaultHeaders: {
			"Accept": "application/json",
			"X-Client-Version": "1.0"
		},
		dedupe: true,
		retryStrategy: retry
	});

	// Получаем полный ответ, а не только данные
	const response = await client
		.get("/users/1")
		.query({ include: "profile,orders" })
		.send(); // вместо .data()

	console.log("Status:", response.status);
	console.log("Headers:", response.headers);
	console.log("Data:", response.data);

	// Загружаем большой файл с отслеживанием прогресса через abort controller
	const controller = new AbortController();

	// Таймаут в 30 секунд
	setTimeout(() => controller.abort(), 30000);

	const fileResponse = await client
		.get("/large-file")
		.responseType("blob")
		.signal(controller.signal)
		.timeout(30000)
		.data();
}
