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
import { HttpClient } from "@cordy/endpoint-builder";

const client = new HttpClient({
	baseUrl: "https://jsonplaceholder.typicode.com",
});

// Get a single post
const post = await client.get("/posts/1").data();
console.log(post);
// { userId: 1, id: 1, title: "...", body: "..." }

// Get all posts with full response info
const response = await client.get("/posts").send();
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

const created = await client.post("/posts").json(newPost).data();

console.log(created); // { id: 101, ...newPost }
```

### PUT and PATCH Requests

```typescript
// Full update with PUT
const updatedPost = await client
	.put("/posts/1")
	.json({
		id: 1,
		title: "Updated Title",
		body: "Updated content",
		userId: 1,
	})
	.data();

// Partial update with PATCH
const patchedPost = await client
	.patch("/posts/1")
	.json({ title: "Only Update Title" })
	.data();
```

### DELETE Request

```typescript
const deleteResponse = await client.delete("/posts/1").send();
console.log(deleteResponse.status); // 200
```

## Working with REST APIs

### Query Parameters

```typescript
const client = new HttpClient({
	baseUrl: "https://api.example.com",
});

// Using query method
const users = await client
	.get("/users")
	.query({
		page: 2,
		limit: 20,
		sort: "name",
		order: "asc",
	})
	.data();

// Query parameters are automatically URL encoded
const searchResults = await client
	.get("/search")
	.query({
		q: "hello world", // Becomes q=hello%20world
		tags: ["javascript", "typescript"], // Becomes tags=javascript&tags=typescript
	})
	.data();
```

### Custom Headers

```typescript
// Set headers for a single request
const response = await client
	.get("/protected-resource")
	.header("X-Custom-Header", "custom-value")
	.header("X-Request-ID", "123456")
	.data();

// Set multiple headers at once
const data = await client
	.post("/api/data")
	.headers({
		"X-API-Version": "2.0",
		"X-Client-ID": "my-app",
		"Accept-Language": "en-US",
	})
	.json({ data: "value" })
	.data();

// Default headers for all requests
const apiClient = new HttpClient({
	baseUrl: "https://api.example.com",
	defaultHeaders: {
		"X-API-Version": "2.0",
		Accept: "application/json",
	},
});
```

## Authentication

### API Key Authentication

```typescript
import { HttpClient, ApiKeyStrategy } from "@cordy/endpoint-builder";

// API key in header
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("X-API-Key", "your-api-key-here"),
});

// API key as query parameter
const clientWithQueryAuth = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("api_key", "your-api-key-here", true),
});

// Bearer token
const bearerClient = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("Authorization", "Bearer your-token-here"),
});
```

### Token Authentication with Refresh

```typescript
import {
	HttpClient,
	OpaqueTokenStrategy,
	LocalStoragePersist,
} from "@cordy/endpoint-builder";

// Setup client with token refresh
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new OpaqueTokenStrategy(
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

const protectedData = await client.get("/protected").data();
```

### Custom Authentication Strategy

```typescript
import { AuthStrategy, HttpHeaders } from "@cordy/endpoint-builder";

class CustomAuthStrategy implements AuthStrategy {
	async enrich(req: Request): Promise<Partial<HttpHeaders>> {
		// Add custom authentication headers
		const timestamp = Date.now().toString();
		const signature = await this.generateSignature(req, timestamp);

		return {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		};
	}

	async refresh(req: Request, res: Response): Promise<boolean> {
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

const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new CustomAuthStrategy(),
});
```

### Disable Authentication for Specific Requests

```typescript
// Client with default authentication
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("X-API-Key", "secret-key"),
});

// This request will include the API key
const protectedData = await client.get("/protected").data();

// This request will NOT include the API key
const publicData = await client
	.get("/public")
	.auth(null) // Disable auth for this request
	.data();
```

## File Operations

### Uploading Files

```typescript
// Single file upload
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const file = fileInput?.files?.[0];

if (file) {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("description", "My file upload");

	const response = await client.post("/upload").body(formData).data();
}

// Multiple files with additional data
const formData = new FormData();
formData.append("files", file1);
formData.append("files", file2);
formData.append(
	"metadata",
	JSON.stringify({ tags: ["important", "document"] }),
);

const result = await client.post("/upload/multiple").body(formData).data();
```

### Downloading Files

```typescript
// Download as blob
const fileBlob = await client
	.get("/files/document.pdf")
	.responseType("blob")
	.data();

// Create download link
const url = URL.createObjectURL(fileBlob);
const a = document.createElement("a");
a.href = url;
a.download = "document.pdf";
a.click();
URL.revokeObjectURL(url);

// Download as ArrayBuffer for processing
const buffer = await client
	.get("/files/data.bin")
	.responseType("arraybuffer")
	.data();

const view = new DataView(buffer);
console.log("First byte:", view.getUint8(0));
```

### Streaming Large Files

```typescript
// Get response as stream
const response = await client
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
	const data = await client.get("/may-fail").data();
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
	const user = await client.get("/users/123").data();
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
	HttpClient,
	JitteredExponentialBackoffRetryStrategy,
} from "@cordy/endpoint-builder";

// Global retry configuration
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	retryStrategy: new JitteredExponentialBackoffRetryStrategy(
		5, // max attempts
		500, // base delay in ms
		30000, // max delay in ms
	),
});

// Disable retry for specific request
const criticalData = await client
	.post("/critical-operation")
	.retry(null) // No retry for this request
	.json({ important: "data" })
	.data();

// Custom retry strategy for specific request
const customRetry = new JitteredExponentialBackoffRetryStrategy(
	10,
	1000,
	60000,
);
const resilientData = await client
	.get("/flaky-endpoint")
	.retry(customRetry)
	.data();
```

## Request Configuration

### Timeout Control

```typescript
// Set timeout for specific request (in milliseconds)
try {
	const data = await client
		.get("/slow-endpoint")
		.timeout(5000) // 5 second timeout
		.data();
} catch (error) {
	if (error.code === "TIMEOUT") {
		console.log("Request timed out");
	}
}
```

### Request Cancellation

```typescript
// Using AbortController
const controller = new AbortController();

// Start request
const promise = client.get("/long-running").signal(controller.signal).data();

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
const controller = new AbortController();

const requests = [
	client.get("/data1").signal(controller.signal).data(),
	client.get("/data2").signal(controller.signal).data(),
	client.get("/data3").signal(controller.signal).data(),
];

// Cancel all requests
controller.abort();
```

### Request Deduplication

```typescript
// Enable deduplication globally
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	dedupe: true,
});

// These identical concurrent requests will return the same promise
const [user1, user2, user3] = await Promise.all([
	client.get("/users/123").data(),
	client.get("/users/123").data(),
	client.get("/users/123").data(),
]);
// Only one actual HTTP request is made

// Enable deduplication for specific requests
const dedupeClient = new HttpClient({ baseUrl: "https://api.example.com" });

const promise1 = dedupeClient.get("/data").dedupe().data();
const promise2 = dedupeClient.get("/data").dedupe().data();
// promise1 === promise2 (same promise instance)
```

### Different Response Types

```typescript
// JSON (default)
const jsonData = await client.get("/api/data").data();

// Plain text
const textContent = await client.get("/readme.txt").responseType("text").data();

// Blob for binary data
const imageBlob = await client.get("/image.png").responseType("blob").data();

// ArrayBuffer for binary processing
const binaryData = await client
	.get("/data.bin")
	.responseType("arraybuffer")
	.data();

// Stream for large data
const stream = await client.get("/large-file").responseType("stream").data();
```

## Parallel Requests

### Promise.all for Multiple Requests

```typescript
const [users, posts, comments] = await Promise.all([
	client.get("/users").data(),
	client.get("/posts").data(),
	client.get("/comments").data(),
]);

// With error handling for individual requests
const results = await Promise.allSettled([
	client.get("/users").data(),
	client.get("/posts").data(),
	client.get("/may-fail").data(),
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
const user = await client.get("/users/1").data();
const posts = await client.get(`/users/${user.id}/posts`).data();

// Chain multiple dependent requests
const orderData = await client
	.post("/orders")
	.json({ items: ["item1", "item2"] })
	.data();

const paymentResult = await client
	.post(`/orders/${orderData.id}/payment`)
	.json({ method: "credit_card", amount: orderData.total })
	.data();

const confirmation = await client
	.get(`/orders/${orderData.id}/confirmation`)
	.data();
```

## Working with GraphQL

```typescript
const graphqlClient = new HttpClient({
	baseUrl: "https://api.example.com/graphql",
	defaultHeaders: {
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

const userData = await graphqlClient
	.post("")
	.json({
		query,
		variables: { id: "123" },
	})
	.data();

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

const newPost = await graphqlClient
	.post("")
	.json({
		query: mutation,
		variables: {
			input: {
				title: "New Post",
				content: "Post content",
			},
		},
	})
	.data();
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
	private client: HttpClient;

	constructor(baseUrl: string) {
		this.client = new HttpClient({ baseUrl });
	}

	async getUser(id: number): Promise<User> {
		return this.client.get<User>(`/users/${id}`).data();
	}

	async getPosts(userId?: number): Promise<Post[]> {
		return this.client
			.get<Post[]>("/posts")
			.query(userId ? { userId } : {})
			.data();
	}

	async createPost(post: CreatePostDto): Promise<Post> {
		return this.client.post<Post>("/posts").json(post).data();
	}

	async updatePost(id: number, updates: Partial<Post>): Promise<Post> {
		return this.client.patch<Post>(`/posts/${id}`).json(updates).data();
	}
}

// Usage
const api = new BlogApiClient("https://jsonplaceholder.typicode.com");
const user = await api.getUser(1); // Type: User
const posts = await api.getPosts(user.id); // Type: Post[]
```

### Generic API Wrapper

```typescript
// Generic CRUD operations
class ApiResource<T, CreateDto = Partial<T>, UpdateDto = Partial<T>> {
	constructor(
		private client: HttpClient,
		private resource: string,
	) {}

	async findAll(query?: Record<string, any>): Promise<T[]> {
		return this.client
			.get<T[]>(`/${this.resource}`)
			.query(query || {})
			.data();
	}

	async findOne(id: string | number): Promise<T> {
		return this.client.get<T>(`/${this.resource}/${id}`).data();
	}

	async create(data: CreateDto): Promise<T> {
		return this.client.post<T>(`/${this.resource}`).json(data).data();
	}

	async update(id: string | number, data: UpdateDto): Promise<T> {
		return this.client.put<T>(`/${this.resource}/${id}`).json(data).data();
	}

	async patch(id: string | number, data: UpdateDto): Promise<T> {
		return this.client
			.patch<T>(`/${this.resource}/${id}`)
			.json(data)
			.data();
	}

	async delete(id: string | number): Promise<void> {
		await this.client.delete(`/${this.resource}/${id}`).send();
	}
}

// Usage
const client = new HttpClient({ baseUrl: "https://api.example.com" });
const usersApi = new ApiResource<User>(client, "users");
const postsApi = new ApiResource<Post, CreatePostDto>(client, "posts");

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
	private client: HttpClient;

	constructor(config: HttpClientOptions) {
		this.client = new HttpClient(config);
	}

	private async intercept<T>(promise: Promise<HttpResponse<T>>): Promise<T> {
		try {
			const response = await promise;

			// Log all responses
			console.log(
				`${response.config.method} ${response.config.url} - ${response.status}`,
			);

			// Check for custom headers
			if (response.headers["x-deprecated"]) {
				console.warn(`Warning: ${response.config.url} is deprecated`);
			}

			// Extract data with custom logic
			if (
				response.data &&
				typeof response.data === "object" &&
				"data" in response.data
			) {
				return response.data.data as T;
			}

			return response.data;
		} catch (error) {
			// Global error handling
			console.error(
				`Request failed: ${error.config?.method} ${error.config?.url}`,
			);
			throw error;
		}
	}

	get<T>(url: string) {
		return {
			...this.client.get<T>(url),
			data: () => this.intercept(this.client.get<T>(url).send()),
		};
	}
}
```

### Batch Requests

```typescript
class BatchRequestClient {
	private client: HttpClient;
	private queue: Array<() => Promise<any>> = [];

	constructor(config: HttpClientOptions) {
		this.client = new HttpClient(config);
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
	.add(() => client.get("/users").data())
	.add(() => client.get("/posts").data())
	.add(() => client.get("/comments").data())
	.execute<[User[], Post[], Comment[]]>();
```

### Caching Layer

```typescript
class CachedHttpClient {
	private client: HttpClient;
	private cache = new Map<string, { data: any; timestamp: number }>();
	private ttl: number;

	constructor(config: HttpClientOptions, ttlSeconds = 300) {
		this.client = new HttpClient(config);
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
		const data = await this.client.get<T>(url).data();

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
const cachedClient = new CachedHttpClient(
	{ baseUrl: "https://api.example.com" },
	600, // 10 minutes TTL
);

// First call - fetches from API
const users1 = await cachedClient.get<User[]>("/users");

// Second call within TTL - returns from cache
const users2 = await cachedClient.get<User[]>("/users");

// Force fresh data
const users3 = await cachedClient.get<User[]>("/users", { bypassCache: true });
```

### API Client Factory

```typescript
// Create different API clients for different services
class ApiClientFactory {
	static create(
		service: "users" | "posts" | "auth",
		token?: string,
	): HttpClient {
		const configs = {
			users: {
				baseUrl: "https://users-api.example.com",
				defaultHeaders: { "X-Service": "users" },
			},
			posts: {
				baseUrl: "https://posts-api.example.com",
				defaultHeaders: { "X-Service": "posts" },
			},
			auth: {
				baseUrl: "https://auth-api.example.com",
				defaultHeaders: { "X-Service": "auth" },
			},
		};

		const config = configs[service];

		if (token) {
			return new HttpClient({
				...config,
				auth: new ApiKeyStrategy("Authorization", `Bearer ${token}`),
			});
		}

		return new HttpClient(config);
	}
}

// Usage
const usersClient = ApiClientFactory.create("users", userToken);
const authClient = ApiClientFactory.create("auth");

const profile = await usersClient.get("/profile").data();
const loginResult = await authClient.post("/login").json(credentials).data();
```

## Testing

### Using with Testing Libraries

```typescript
import { HttpClient } from "@cordy/endpoint-builder";
import { describe, it, expect, beforeEach } from "vitest";

describe("User API", () => {
	let client: HttpClient;

	beforeEach(() => {
		client = new HttpClient({
			baseUrl: "https://jsonplaceholder.typicode.com",
		});
	});

	it("should fetch user by id", async () => {
		const user = await client.get<User>("/users/1").data();

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

		const created = await client.post<Post>("/posts").json(newPost).data();

		expect(created.id).toBeDefined();
		expect(created.title).toBe(newPost.title);
	});
});
```

## Conclusion

The endpoint-builder library provides a powerful and flexible API for making HTTP requests with excellent TypeScript support. Its zero-dependency architecture, built-in retry mechanisms, and authentication strategies make it suitable for both simple and complex applications.

Key takeaways:

- Use type parameters for type-safe responses
- Leverage the fluent API for readable request configuration
- Take advantage of built-in features like retry, deduplication, and authentication
- Create abstractions on top of HttpClient for your specific use cases

For more details, see the [API documentation](./API.md).
