/**
 * Simple usage examples for SimpleClient
 * Demonstrate basic scenarios without complexity
 */

import { createClient } from "../../src/simple";

// Пример 1: Базовое использование
async function basicExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	// GET запрос
	const posts = await api.get("/posts");
	console.log("Posts:", posts);

	// POST запрос
	const newPost = await api.post("/posts", {
		title: "My New Post",
		body: "This is the content",
		userId: 1
	});
	console.log("Created post:", newPost);
}

// Пример 2: С аутентификацией
async function authExample() {
	// API ключ
	const api = createClient({
		baseUrl: "https://api.example.com",
		apiKey: "your-api-key-123"
	});

	// Или Bearer токен
	const _apiWithToken = createClient({
		baseUrl: "https://api.example.com",
		auth: "your-token-123" // автоматически добавит "Bearer "
	});

	const userData = await api.get("/profile");
	console.log("User data:", userData);
}

// Пример 3: Загрузка файлов
async function fileUploadExample() {
	const api = createClient({
		baseUrl: "https://httpbin.org"
	});

	// Создаем тестовый файл
	const file = new File(["Hello, world!"], "test.txt", { type: "text/plain" });

	// Загружаем файл
	const result = await api.upload("/post", {
		file: file,
		description: "Test file upload"
	});

	console.log("Upload result:", result);
}

// Пример 4: Обработка ошибок
async function errorHandlingExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	try {
		// Запрос несуществующего ресурса
		const data = await api.get("/posts/9999");
		console.log("Data:", data);
	} catch (error: any) {
		console.log("Error status:", error.status);
		console.log("Error message:", error.message);

		if (error.status === 404) {
			console.log("Resource not found");
		}
	}
}

// Пример 5: Query параметры
async function queryExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	// GET с query параметрами
	const posts = await api.get("/posts", {
		query: {
			userId: 1,
			_limit: 5
		}
	});

	console.log("Filtered posts:", posts);
}

// Пример 6: Кастомные заголовки
async function headersExample() {
	const api = createClient({
		baseUrl: "https://httpbin.org",
		headers: {
			"X-App-Name": "MyApp",
			"X-App-Version": "1.0.0"
		}
	});

	// Запрос с дополнительными заголовками
	const response = await api.response("GET", "/headers", {
		headers: {
			"X-Request-ID": "12345"
		}
	});

	console.log("Response headers:", response.data);
}

// Пример 7: Скачивание файлов
async function downloadExample() {
	const api = createClient({
		baseUrl: "https://httpbin.org"
	});

	// Скачиваем изображение как Blob
	const imageBlob = await api.download("/image/png");

	console.log("Downloaded image size:", imageBlob.size, "bytes");
	console.log("Image type:", imageBlob.type);
}

// Пример 8: Полный ответ с метаданными
async function fullResponseExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	// Получаем полный ответ
	const response = await api.response("GET", "/posts/1");

	console.log("Status:", response.status);
	console.log("Headers:", response.headers);
	console.log("Data:", response.data);
}

// Пример 9: CRUD операции
async function crudExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	// CREATE
	const newPost = await api.post("/posts", {
		title: "New Post",
		body: "Post content",
		userId: 1
	});
	console.log("Created:", newPost);

	// READ
	const post = await api.get(`/posts/${newPost.id}`);
	console.log("Read:", post);

	// UPDATE
	const updated = await api.put(`/posts/${newPost.id}`, {
		id: newPost.id,
		title: "Updated Post",
		body: "Updated content",
		userId: 1
	});
	console.log("Updated:", updated);

	// PATCH
	const patched = await api.patch(`/posts/${newPost.id}`, {
		title: "Patched Title"
	});
	console.log("Patched:", patched);

	// DELETE
	const deleted = await api.delete(`/posts/${newPost.id}`);
	console.log("Deleted:", deleted);
}

// Пример 10: Доступ к продвинутому API
async function advancedApiExample() {
	const api = createClient({
		baseUrl: "https://jsonplaceholder.typicode.com"
	});

	// Используем продвинутый API через .advanced
	const response = await api.advanced
		.get("/posts")
		.query({ _limit: 3 })
		.header("X-Custom", "value")
		.timeout(10000)
		.dedupe(false)
		.send();

	console.log("Advanced response:", response);
}

// Экспортируем все примеры
export {
	advancedApiExample,
	authExample,
	basicExample,
	crudExample,
	downloadExample,
	errorHandlingExample,
	fileUploadExample,
	fullResponseExample,
	headersExample,
	queryExample
};
