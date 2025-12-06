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
	const _user = await client
		.get("/users/1")
		.data();
	void _user;

	// POST запрос с JSON телом
	const _newUser = await client
		.post("/users")
		.json({ name: "John", email: "john@example.com" })
		.data();
	void _newUser;

	// PUT запрос с заголовками
	const _updatedUser = await client
		.put("/users/1")
		.json({ name: "John Updated" })
		.header("X-Custom-Header", "value")
		.data();
	void _updatedUser;

	// DELETE запрос
	const _deleted = await client
		.delete("/users/1")
		.data();
	void _deleted;

	// GET запрос с query параметрами
	const _searchResults = await client
		.get("/users")
		.query({ search: "john", page: 1, limit: 10 })
		.data();
	void _searchResults;
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
	const _data = await client
		.get("/protected-resource")
		.data();
	void _data;
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
	const _data2 = await client
		.get("/protected-resource")
		.data();
	void _data2;
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
	const retry = new ExponentialRetryStrategy({
		maxAttempts: 3,      // максимум 3 попытки
		baseDelay: 500,      // базовая задержка 500 мс
		maxDelay: 10000      // максимальная задержка 10 секунд
	});

	// Создаем HTTP клиент со стратегией повторных попыток
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		retryStrategy: retry
	});

	// При ошибках 5xx или сетевых проблемах запрос будет повторяться автоматически
	const _data3 = await client
		.get("/resource-that-might-fail")
		.data();
	void _data3;
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
	const _result = await client
		.post("/upload")
		.form(formData, false) // false означает использование multipart/form-data вместо x-www-form-urlencoded
		.data();
	void _result;
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
	const retry = new ExponentialRetryStrategy({ maxAttempts: 3 });

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

	const _fileResponse = await client
		.get("/large-file")
		.responseType("blob")
		.signal(controller.signal)
		.timeout(30000)
		.data();
	void _fileResponse;
}
