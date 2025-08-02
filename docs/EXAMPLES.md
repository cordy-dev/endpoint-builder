# Usage Examples for endpoint-builder

This guide shows practical examples of using the endpoint-builder library in various real-world scenarios.

## Table of Contents

- [Basic Usage](#basic-usage)
- [Working with REST APIs](#working-with-rest-apis)
- [Authentication](#authentication)
- [File Operations](#file-operations)
- [Error Handling](#error-handling)
- [Request Configuration](#request-configuration)
- [Parallel Requests](#parallel-requests)
- [Working with GraphQL](#working-with-graphql)
- [TypeScript Integration](#typescript-integration)
- [Advanced Patterns](#advanced-patterns)

## Basic Usage

### Simple GET Request

```typescript
import { createClient } from "@cordy/endpoint-builder";

const api = createClient({
	baseUrl: "https://jsonplaceholder.typicode.com",
});

// Get a single post
const post = await api.get("/posts/1");
console.log(post);
// { userId: 1, id: 1, title: "...", body: "..." }

// Get all posts with full response info
const response = await api.response("GET", "/posts");
console.log(response.status); // 200
console.log(response.headers); // { "content-type": "application/json; charset=utf-8", ... }
console.log(response.data); // Array of posts
```

### POST Request with JSON Body

```typescript
const newPost = {
	title: "My New Post",
	body: "This is the content of my post",
	userId: 1,
};

const created = await api.post("/posts", newPost);
console.log(created); // { id: 101, ...newPost }
```

### PUT and PATCH Requests

```typescript
// Full update with PUT
const updatedPost = await api.put("/posts/1", {
	id: 1,
	title: "Updated Title",
	body: "Updated content",
	userId: 1,
});

// Partial update with PATCH
const patchedPost = await api.patch("/posts/1", { title: "Only Update Title" });
```

### DELETE Request

```typescript
await api.delete("/posts/1");

// Get full response for DELETE
const deleteResponse = await api.response("DELETE", "/posts/1");
console.log(deleteResponse.status); // 200
```

## Working with REST APIs

### Query Parameters

```typescript
const api = createClient({
	baseUrl: "https://api.example.com",
});

// Using query option
const users = await api.get("/users", {
	query: {
		page: 2,
		limit: 20,
		sort: "name",
		order: "asc",
	},
});

// Query parameters are automatically URL encoded
const searchResults = await api.get("/search", {
	query: {
		q: "hello world", // Becomes q=hello%20world
		tags: ["javascript", "typescript"], // Becomes tags=javascript&tags=typescript
	},
});

// Using advanced API for complex queries
const advancedResults = await api
	.request("GET", "/search")
	.query({
		q: "hello world",
		filters: { category: "tech", active: true },
	})
	.data();
```

### Custom Headers

```typescript
// Set headers for a single request
const response = await api.get("/protected-resource", {
	headers: {
		"X-Custom-Header": "custom-value",
		"X-Request-ID": "123456",
	},
});

// Set multiple headers using advanced API
const data = await api
	.request("POST", "/api/data")
	.headers({
		"X-API-Version": "2.0",
		"X-Client-ID": "my-app",
		"Accept-Language": "en-US",
	})
	.json({ data: "value" })
	.data();

// Default headers for all requests
const apiClient = createClient({
	baseUrl: "https://api.example.com",
	headers: {
		"X-API-Version": "2.0",
		Accept: "application/json",
	},
});
```

## Authentication

### API Key Authentication

```typescript
import { createClient, ApiKeyStrategy } from "@cordy/endpoint-builder";

// Simple API key using createClient
const api = createClient({
	baseUrl: "https://api.example.com",
	apiKey: "your-api-key-here", // Automatically uses X-API-Key header
});

// Custom API key header
const customApi = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new ApiKeyStrategy("X-Custom-Key", "your-api-key-here"),
});

// API key as query parameter
const queryApi = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new ApiKeyStrategy("api_key", "your-api-key-here", true),
});

// Bearer token
const bearerApi = createClient({
	baseUrl: "https://api.example.com",
	auth: "your-token-here", // Automatically becomes "Bearer your-token-here"
});
```

### Token Authentication with Refresh

```typescript
import {
	createClient,
	OpaqueTokenStrategy,
	LocalStoragePersist,
} from "@cordy/endpoint-builder";

// Setup client with token refresh
const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new OpaqueTokenStrategy(
		new LocalStoragePersist(),
		"https://api.example.com/auth/refresh",
	),
});

// First, login to get tokens
const loginResponse = await fetch("https://api.example.com/auth/login", {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ username: "user", password: "pass" }),
});

const tokens = await loginResponse.json();
// Expected format: { access: "access_token", refresh: "refresh_token" }

// Store tokens manually
const storage = new LocalStoragePersist();
await storage.set("tokens", tokens);

// Now the client will automatically:
// 1. Add "Authorization: Bearer access_token" to requests
// 2. Refresh tokens when receiving 401/403 responses
// 3. Retry the failed request with new token

const protectedData = await api.get("/protected");
```

### Custom Authentication Strategy

```typescript
import {
	createClient,
	AuthStrategy,
	HttpHeaders,
} from "@cordy/endpoint-builder";

class CustomAuthStrategy implements AuthStrategy {
	async enrichRequest(req: Request): Promise<Partial<HttpHeaders>> {
		// Add custom authentication headers
		const timestamp = Date.now().toString();
		const signature = await this.generateSignature(req, timestamp);

		return {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		};
	}

	async handleRequestError?(req: Request, res: Response): Promise<boolean> {
		// Custom refresh logic if needed
		return false;
	}

	private async generateSignature(
		req: Request,
		timestamp: string,
	): Promise<string> {
		// Your signature generation logic
		return "generated-signature";
	}
}

const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new CustomAuthStrategy(),
});
```

### Disable Authentication for Specific Requests

```typescript
// Client with default authentication
const api = createClient({
	baseUrl: "https://api.example.com",
	apiKey: "secret-key",
});

// This request will include the API key
const protectedData = await api.get("/protected");

// This request will NOT include the API key
const publicData = await api
	.request("GET", "/public")
	.auth(null) // Disable auth for this request
	.data();
```

## File Operations

### Uploading Files

```typescript
// Using the upload method
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const file = fileInput?.files?.[0];

if (file) {
	const response = await api.upload("/upload", {
		file: file,
		description: "My file upload",
	});
}

// Advanced file upload using RequestBuilder
const formData = new FormData();
formData.append("file", file);
formData.append("description", "My file upload");

const result = await api
	.request("POST", "/upload")
	.body(formData)
	.timeout(30000)
	.data();

// Multiple files with additional data
const multipleFiles = await api.upload("/upload/multiple", {
	file1: file1,
	file2: file2,
	metadata: JSON.stringify({ tags: ["important", "document"] }),
});
```

### Downloading Files

```typescript
// Download as blob using download method
const fileBlob = await api.download("/files/document.pdf");

// Create download link
const url = URL.createObjectURL(fileBlob);
const a = document.createElement("a");
a.href = url;
a.download = "document.pdf";
a.click();
URL.revokeObjectURL(url);

// Download as ArrayBuffer for processing using advanced API
const buffer = await api.httpClient
	.get("/files/data.bin")
	.responseType("arraybuffer")
	.data();

const view = new DataView(buffer);
console.log("First byte:", view.getUint8(0));
```

### Streaming Large Files

```typescript
// Get response as stream using advanced API
const response = await api.httpClient
	.get("/large-file.zip")
	.responseType("stream")
	.send();

const reader = response.data.getReader();
let receivedBytes = 0;

while (true) {
	const { done, value } = await reader.read();
	if (done) break;

	receivedBytes += value.length;
	console.log(`Received ${receivedBytes} bytes`);

	// Process chunk...
}
```

## Error Handling

### Basic Error Handling

```typescript
try {
	const data = await api.get("/may-fail");
	console.log(data);
} catch (error) {
	if (error.response) {
		// Server responded with error status
		console.error("Status:", error.status);
		console.error("Response:", error.response.data);
	} else if (error.config) {
		// Request was made but no response received
		console.error("Network error:", error.message);
	} else {
		// Something else happened
		console.error("Error:", error.message);
	}
}
```

### Handling Specific Status Codes

```typescript
try {
	const user = await api.get("/users/123");
} catch (error) {
	switch (error.status) {
		case 404:
			console.log("User not found");
			break;
		case 401:
			console.log("Please login");
			break;
		case 403:
			console.log("Access denied");
			break;
		case 500:
			console.log("Server error, please try again later");
			break;
		default:
			console.log("An error occurred:", error.message);
	}
}
```

### Retry Strategy

```typescript
import {
	createClient,
	ExponentialRetryStrategy,
} from "@cordy/endpoint-builder";

// Global retry configuration
const api = createClient({
	baseUrl: "https://api.example.com",
	retryStrategy: new ExponentialRetryStrategy(
		5, // max attempts
		500, // base delay in ms
		30000, // max delay in ms
	),
});

// Disable retry for specific request
const criticalData = await api
	.request("POST", "/critical-operation")
	.retry(null) // No retry for this request
	.json({ important: "data" })
	.data();

// Custom retry strategy for specific request
const customRetry = new ExponentialRetryStrategy(10, 1000, 60000);
const resilientData = await api
	.request("GET", "/flaky-endpoint")
	.retry(customRetry)
	.data();
```

## Request Configuration

### Timeout Control

```typescript
// Set timeout for specific request using simple API
try {
	const data = await api.get("/slow-endpoint", { timeout: 5000 });
} catch (error) {
	if (error.name === "AbortError") {
		console.log("Request timed out");
	}
}

// Using advanced API
const data = await api
	.request("GET", "/slow-endpoint")
	.timeout(5000) // 5 second timeout
	.data();
```

### Request Cancellation

```typescript
// Using AbortController with advanced API
const controller = new AbortController();

// Start request
const promise = api
	.request("GET", "/long-running")
	.signal(controller.signal)
	.data();

// Cancel after 2 seconds
setTimeout(() => controller.abort(), 2000);

try {
	const data = await promise;
} catch (error) {
	if (error.name === "AbortError") {
		console.log("Request was cancelled");
	}
}

// Cancel multiple requests
const controller2 = new AbortController();

const requests = [
	api.httpClient.get("/data1").signal(controller2.signal).data(),
	api.httpClient.get("/data2").signal(controller2.signal).data(),
	api.httpClient.get("/data3").signal(controller2.signal).data(),
];

// Cancel all requests
controller2.abort();
```

### Request Deduplication

```typescript
// Enable deduplication globally
const api = createClient({
	baseUrl: "https://api.example.com",
	dedupe: true,
});

// These identical concurrent requests will return the same promise
const [user1, user2, user3] = await Promise.all([
	api.get("/users/123"),
	api.get("/users/123"),
	api.get("/users/123"),
]);
// Only one actual HTTP request is made

// Enable deduplication for specific requests using advanced API
const promise1 = api.httpClient.get("/data").dedupe().data();
const promise2 = api.httpClient.get("/data").dedupe().data();
// promise1 === promise2 (same promise instance)
```

### Different Response Types

```typescript
// JSON (default)
const jsonData = await api.get("/api/data");

// Plain text using advanced API
const textContent = await api.httpClient
	.get("/readme.txt")
	.responseType("text")
	.data();

// Blob for binary data
const imageBlob = await api.httpClient
	.get("/image.png")
	.responseType("blob")
	.data();

// ArrayBuffer for binary processing
const binaryData = await api.httpClient
	.get("/data.bin")
	.responseType("arraybuffer")
	.data();

// Stream for large data
const stream = await api.httpClient
	.get("/large-file")
	.responseType("stream")
	.data();
```

## Parallel Requests

### Promise.all for Multiple Requests

```typescript
const [users, posts, comments] = await Promise.all([
	api.get("/users"),
	api.get("/posts"),
	api.get("/comments"),
]);

// With error handling for individual requests
const results = await Promise.allSettled([
	api.get("/users"),
	api.get("/posts"),
	api.get("/may-fail"),
]);

results.forEach((result, index) => {
	if (result.status === "fulfilled") {
		console.log(`Request ${index} succeeded:`, result.value);
	} else {
		console.log(`Request ${index} failed:`, result.reason);
	}
});
```

### Sequential Requests with Dependencies

```typescript
// Get user, then their posts
const user = await api.get("/users/1");
const posts = await api.get(`/users/${user.id}/posts`);

// Chain multiple dependent requests
const orderData = await api.post("/orders", { items: ["item1", "item2"] });

const paymentResult = await api.post(`/orders/${orderData.id}/payment`, {
	method: "credit_card",
	amount: orderData.total,
});

const confirmation = await api.get(`/orders/${orderData.id}/confirmation`);
```

## Working with GraphQL

```typescript
const graphqlApi = createClient({
	baseUrl: "https://api.example.com/graphql",
	headers: {
		"Content-Type": "application/json",
	},
});

// GraphQL query
const query = `
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
      posts {
        id
        title
      }
    }
  }
`;

const userData = await graphqlApi.post("", {
	query,
	variables: { id: "123" },
});

// GraphQL mutation
const mutation = `
  mutation CreatePost($input: PostInput!) {
    createPost(input: $input) {
      id
      title
      createdAt
    }
  }
`;

const newPost = await graphqlApi.post("", {
	query: mutation,
	variables: {
		input: {
			title: "New Post",
			content: "Post content",
		},
	},
});
```

## TypeScript Integration

### Type-Safe Requests

```typescript
// Define your API types
interface User {
	id: number;
	name: string;
	email: string;
}

interface Post {
	id: number;
	userId: number;
	title: string;
	body: string;
}

interface CreatePostDto {
	title: string;
	body: string;
	userId: number;
}

// Type-safe API client
class BlogApiClient {
	private api;

	constructor(baseUrl: string) {
		this.api = createClient({ baseUrl });
	}

	async getUser(id: number): Promise<User> {
		return this.api.get<User>(`/users/${id}`);
	}

	async getPosts(userId?: number): Promise<Post[]> {
		return this.api.get<Post[]>("/posts", {
			query: userId ? { userId } : {},
		});
	}

	async createPost(post: CreatePostDto): Promise<Post> {
		return this.api.post<Post>("/posts", post);
	}

	async updatePost(id: number, updates: Partial<Post>): Promise<Post> {
		return this.api.patch<Post>(`/posts/${id}`, updates);
	}
}

// Usage
const blogApi = new BlogApiClient("https://jsonplaceholder.typicode.com");
const user = await blogApi.getUser(1); // Type: User
const posts = await blogApi.getPosts(user.id); // Type: Post[]
```

### Generic API Wrapper

```typescript
// Generic CRUD operations
class ApiResource<T, CreateDto = Partial<T>, UpdateDto = Partial<T>> {
	constructor(
		private api: ReturnType<typeof createClient>,
		private resource: string,
	) {}

	async findAll(query?: Record<string, any>): Promise<T[]> {
		return this.api.get<T[]>(`/${this.resource}`, { query: query || {} });
	}

	async findOne(id: string | number): Promise<T> {
		return this.api.get<T>(`/${this.resource}/${id}`);
	}

	async create(data: CreateDto): Promise<T> {
		return this.api.post<T>(`/${this.resource}`, data);
	}

	async update(id: string | number, data: UpdateDto): Promise<T> {
		return this.api.put<T>(`/${this.resource}/${id}`, data);
	}

	async patch(id: string | number, data: UpdateDto): Promise<T> {
		return this.api.patch<T>(`/${this.resource}/${id}`, data);
	}

	async delete(id: string | number): Promise<void> {
		await this.api.delete(`/${this.resource}/${id}`);
	}
}

// Usage
const api = createClient({ baseUrl: "https://api.example.com" });
const usersApi = new ApiResource<User>(api, "users");
const postsApi = new ApiResource<Post, CreatePostDto>(api, "posts");

const users = await usersApi.findAll({ active: true });
const newUser = await usersApi.create({
	name: "John",
	email: "john@example.com",
});
```

## Advanced Patterns

### Custom Response Interceptor

```typescript
// Create a wrapper that processes all responses
class ApiClientWithInterceptor {
	private api;

	constructor(config: Parameters<typeof createClient>[0]) {
		this.api = createClient(config);
	}

	private async intercept<T>(promise: Promise<T>): Promise<T> {
		try {
			const data = await promise;

			// Log all responses
			console.log(`Request completed successfully`);

			// Custom data processing
			if (
				data &&
				typeof data === "object" &&
				"data" in data &&
				"status" in data
			) {
				return (data as any).data as T;
			}

			return data;
		} catch (error) {
			// Global error handling
			console.error(`Request failed:`, error.message);
			throw error;
		}
	}

	async get<T>(url: string, options?: any): Promise<T> {
		return this.intercept(this.api.get<T>(url, options));
	}

	async post<T>(url: string, data?: any, options?: any): Promise<T> {
		return this.intercept(this.api.post<T>(url, data, options));
	}
}
```

### Batch Requests

```typescript
class BatchRequestClient {
	private api;
	private queue: Array<() => Promise<any>> = [];

	constructor(config: Parameters<typeof createClient>[0]) {
		this.api = createClient(config);
	}

	add<T>(request: () => Promise<T>): this {
		this.queue.push(request);
		return this;
	}

	async execute<T extends any[]>(): Promise<T> {
		const results = await Promise.all(this.queue.map((req) => req()));
		this.queue = [];
		return results as T;
	}
}

// Usage
const batch = new BatchRequestClient({ baseUrl: "https://api.example.com" });

const [users, posts, comments] = await batch
	.add(() => batch.api.get("/users"))
	.add(() => batch.api.get("/posts"))
	.add(() => batch.api.get("/comments"))
	.execute<[User[], Post[], Comment[]]>();
```

### Caching Layer

```typescript
class CachedHttpClient {
	private api;
	private cache = new Map<string, { data: any; timestamp: number }>();
	private ttl: number;

	constructor(config: Parameters<typeof createClient>[0], ttlSeconds = 300) {
		this.api = createClient(config);
		this.ttl = ttlSeconds * 1000;
	}

	async get<T>(url: string, options?: { bypassCache?: boolean }): Promise<T> {
		const cacheKey = url;

		if (!options?.bypassCache) {
			const cached = this.cache.get(cacheKey);
			if (cached && Date.now() - cached.timestamp < this.ttl) {
				console.log(`Cache hit: ${url}`);
				return cached.data;
			}
		}

		console.log(`Cache miss: ${url}`);
		const data = await this.api.get<T>(url);

		this.cache.set(cacheKey, {
			data,
			timestamp: Date.now(),
		});

		return data;
	}

	clearCache(url?: string) {
		if (url) {
			this.cache.delete(url);
		} else {
			this.cache.clear();
		}
	}
}

// Usage
const cachedApi = new CachedHttpClient(
	{ baseUrl: "https://api.example.com" },
	600, // 10 minutes TTL
);

// First call - fetches from API
const users1 = await cachedApi.get<User[]>("/users");

// Second call within TTL - returns from cache
const users2 = await cachedApi.get<User[]>("/users");

// Force fresh data
const users3 = await cachedApi.get<User[]>("/users", { bypassCache: true });
```

### API Client Factory

```typescript
// Create different API clients for different services
class ApiClientFactory {
	static create(
		service: "users" | "posts" | "auth",
		token?: string,
	): ReturnType<typeof createClient> {
		const configs = {
			users: {
				baseUrl: "https://users-api.example.com",
				headers: { "X-Service": "users" },
			},
			posts: {
				baseUrl: "https://posts-api.example.com",
				headers: { "X-Service": "posts" },
			},
			auth: {
				baseUrl: "https://auth-api.example.com",
				headers: { "X-Service": "auth" },
			},
		};

		const config = configs[service];

		if (token) {
			return createClient({
				...config,
				auth: token,
			});
		}

		return createClient(config);
	}
}

// Usage
const usersApi = ApiClientFactory.create("users", userToken);
const authApi = ApiClientFactory.create("auth");

const profile = await usersApi.get("/profile");
const loginResult = await authApi.post("/login", credentials);
```

## Testing

### Using with Testing Libraries

```typescript
import { createClient } from "@cordy/endpoint-builder";
import { describe, it, expect, beforeEach } from "vitest";

describe("User API", () => {
	let api: ReturnType<typeof createClient>;

	beforeEach(() => {
		api = createClient({
			baseUrl: "https://jsonplaceholder.typicode.com",
		});
	});

	it("should fetch user by id", async () => {
		const user = await api.get<User>("/users/1");

		expect(user).toBeDefined();
		expect(user.id).toBe(1);
		expect(user.email).toBeTruthy();
	});

	it("should create a new post", async () => {
		const newPost = {
			title: "Test Post",
			body: "This is a test",
			userId: 1,
		};

		const created = await api.post<Post>("/posts", newPost);

		expect(created.id).toBeDefined();
		expect(created.title).toBe(newPost.title);
	});
});
```

## Conclusion

The endpoint-builder library provides a powerful and flexible API for making HTTP requests with excellent TypeScript support. Its zero-dependency architecture, built-in retry mechanisms, and authentication strategies make it suitable for both simple and complex applications.

Key takeaways:

- Use the `createClient` function for both simple and advanced use cases
- Leverage the fluent API for readable request configuration
- Take advantage of built-in features like retry, deduplication, and authentication
- Create abstractions on top of the client for your specific use cases
- Use TypeScript generics for type-safe responses

For more details, see the [API documentation](./API.md).
