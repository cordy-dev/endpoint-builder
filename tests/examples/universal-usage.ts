/**
 * Универсальные примеры использования endpoint-builder
 * Показывают как один createClient может покрыть все сценарии
 */

import { ApiKeyStrategy } from "../../src/auth/ApiKeyStrategy";
import { OpaqueTokenStrategy } from "../../src/auth/OpaqueTokenStrategy";
import { ExponentialRetryStrategy } from "../../src/retry/ExponentialRetryStrategy";
import { createClient } from "../../src/simple";
import { LocalStoragePersist } from "../../src/storage/LocalStoragePersist";

// ==========================================
// ПРОСТЫЕ СЦЕНАРИИ
// ==========================================

// Пример 1: Базовое использование
async function basicUsage() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	const users = await api.get("/users");
	const newPost = await api.post("/posts", {
		title: "New Post",
		body: "Content",
		userId: 1
	});

	console.log("Users:", users);
	console.log("New post:", newPost);
}

// Пример 2: Простая аутентификация
async function simpleAuth() {
	// API ключ
	const api1 = createClient({
		baseUrl: "https://api.example.com",
		apiKey: "your-api-key-123"
	});

	// Bearer токен (автоматически добавит Bearer)
	// @ts-expect-error - используется только для демонстрации
	const _api2 = createClient({
		baseUrl: "https://api.example.com",
		auth: "your-token-123"
	});

	const userData = await api1.get("/profile");
	console.log("User data:", userData);
}

// Пример 3: Простые настройки
async function simpleSettings() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		timeout: 10000,           // 10 секунд
		retry: false,             // Отключить повторы
		headers: {                // Дефолтные заголовки
			"X-App": "MyApp",
			"X-Version": "1.0"
		}
	});

	const data = await api.get("/data");
	console.log("Data:", data);
}

// ==========================================
// ПРОДВИНУТЫЕ СЦЕНАРИИ
// ==========================================

// Пример 4: Кастомная аутентификация
async function advancedAuth() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		authStrategy: new ApiKeyStrategy("Custom-Auth-Header", "secret-key"),
		storage: new LocalStoragePersist()
	});

	const data = await api.get("/protected");
	console.log("Protected data:", data);
}

// Пример 5: Продвинутые retry стратегии
async function advancedRetry() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		retryStrategy: new ExponentialRetryStrategy(
			10,    // максимум 10 попыток
			2000,  // начальная задержка 2 секунды
			60000  // максимальная задержка 1 минута
		)
	});

	const data = await api.get("/flaky-endpoint");
	console.log("Resilient data:", data);
}

// Пример 6: Токен с автообновлением
async function tokenRefreshAuth() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		authStrategy: new OpaqueTokenStrategy(
			new LocalStoragePersist(),
			"https://api.example.com/auth/refresh"
		),
		storage: new LocalStoragePersist()
	});

	// Токены автоматически обновятся при необходимости
	const data = await api.get("/protected");
	console.log("Auto-refreshed data:", data);
}

// ==========================================
// СМЕШАННОЕ ИСПОЛЬЗОВАНИЕ
// ==========================================

// Пример 7: Простой API + доступ к продвинутому
async function mixedUsage() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		apiKey: "simple-key"
	});

	// Простое использование
	const users = await api.get("/users");

	// Продвинутое использование того же клиента
	const advancedResponse = await api.request("GET", "/advanced")
		.timeout(30000)
		.header("X-Special", "value")
		.retry(new ExponentialRetryStrategy(5, 500, 10000))
		.send();

	// Доступ к полному HttpClient
	const fullResponse = await api.httpClient
		.post("/complex")
		.json({ data: "complex" })
		.dedupe(false)
		.responseType("blob")
		.data();

	console.log("Simple users:", users);
	console.log("Advanced response:", advancedResponse);
	console.log("Full response:", fullResponse);
}

// Пример 8: Все возможности в одном клиенте
async function fullFeatured() {
	const api = createClient({
		baseUrl: "https://api.example.com",

		// Продвинутая аутентификация
		authStrategy: new OpaqueTokenStrategy(
			new LocalStoragePersist(),
			"https://api.example.com/auth/refresh"
		),

		// Кастомные настройки
		retryStrategy: new ExponentialRetryStrategy(7, 1000, 30000),
		timeout: 15000,
		dedupe: true,

		// Дефолтные заголовки
		headers: {
			"X-Client": "Universal",
			"Accept": "application/json"
		}
	});

	// Простые методы работают
	const users = await api.get("/users", {
		query: { active: true }
	});

	// Загрузка файлов
	const file = new File(["content"], "test.txt");
	const uploadResult = await api.upload("/upload", { file });

	// Продвинутые методы доступны
	const complexResponse = await api.request("POST", "/complex")
		.json({ complex: "data" })
		.timeout(60000)
		.header("X-Priority", "high")
		.send();

	console.log("Users:", users);
	console.log("Upload:", uploadResult);
	console.log("Complex:", complexResponse);
}

// ==========================================
// МИГРАЦИЯ СО СТАРОГО API
// ==========================================

// Пример 9: Миграция с HttpClient на createClient
async function migrationExample() {
	// СТАРЫЙ СПОСОБ (все еще работает)
	/*
	import { HttpClient, ApiKeyStrategy } from "@cordy/endpoint-builder";
	const client = new HttpClient({
		baseUrl: "https://api.example.com",
		auth: new ApiKeyStrategy("X-API-Key", "key"),
	});
	const data = await client.get("/users").data();
	*/

	// НОВЫЙ СПОСОБ (проще)
	const api = createClient({
		baseUrl: "https://api.example.com",
		apiKey: "key"
	});
	const data = await api.get("/users");

	// Если нужен доступ к старому API
	const oldStyleResponse = await api.httpClient.get("/users").data();

	console.log("New style:", data);
	console.log("Old style:", oldStyleResponse);
}

// ==========================================
// СПЕЦИАЛЬНЫЕ СЛУЧАИ
// ==========================================

// Пример 10: Отключение всех автоматизмов
async function barebones() {
	const api = createClient({
		baseUrl: "https://api.example.com",
		retry: false,           // Никаких повторов
		dedupe: false,          // Никакой дедупликации
		retryStrategy: null,    // Явно отключаем retry
		timeout: 0              // Без таймаута
	});

	const data = await api.get("/raw");
	console.log("Raw data:", data);
}

export {
	advancedAuth,
	advancedRetry,
	barebones,
	basicUsage,
	fullFeatured,
	migrationExample,
	mixedUsage,
	simpleAuth,
	simpleSettings,
	tokenRefreshAuth
};
