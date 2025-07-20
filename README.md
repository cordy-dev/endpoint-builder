# HTTP Endpoint Builder

Modern, type-safe HTTP client for TypeScript applications with zero dependencies. Built on native fetch with advanced features for real-world applications.

## Why Choose This Library?

🎯 **Zero Dependencies** - No bloated node_modules, just native fetch
⚡ **Type Safety** - Full TypeScript support with autocompletion
🔄 **Smart Retry Logic** - Built-in exponential backoff and custom strategies
🔐 **Advanced Auth** - Bearer, API Key, Basic, and custom authentication
🎭 **Mock Support** - Perfect for development and testing
💾 **Request Caching** - Automatic deduplication of parallel requests

## Quick Start

```bash
npm install @cordy/endpoint-builder
```

```typescript
import { HttpClient, BearerAuthStrategy } from "@cordy/endpoint-builder";

// Create client with authentication
const client = new HttpClient(
	"https://api.example.com",
	new BearerAuthStrategy(() => localStorage.getItem("token") || ""),
);

// Simple requests
const user = await client.get("/user/123").data();
const users = await client.get("/users").params({ page: 1 }).data();

// Post with JSON
const newUser = await client
	.post("/users")
	.json({ name: "John", email: "john@example.com" })
	.data();
```

## Core Concepts

### HTTP Client

The `HttpClient` is your main entry point. Create one instance per API:

```typescript
// Simple client (no auth)
const api = new HttpClient("https://api.example.com");

// With authentication
const authApi = new HttpClient(
	"https://api.example.com",
	new BearerAuthStrategy(() => getToken()),
);

// Explicitly no auth with null
const publicApi = new HttpClient("https://api.example.com", null);

// With options
const configuredApi = new HttpClient("https://api.example.com", undefined, {
	timeout: 10000,
	cache: true,
});
```

### Fluent Request Building

Chain methods to build your request:

```typescript
const response = await client
	.get("/search")
	.params({ q: "typescript", limit: 20 })
	.headers({ Accept: "application/json" })
	.timeout(5000)
	.execute();

// Or just get the data
const data = await client.post("/items").json({ title: "New Item" }).data();
```

### Authentication Strategies

#### Bearer Token

```typescript
const auth = new BearerAuthStrategy(() => "your-token");
const client = new HttpClient("https://api.example.com", auth);
```

#### API Key

```typescript
const auth = new ApiKeyAuthStrategy(() => "your-key", "X-API-Key");
const client = new HttpClient("https://api.example.com", auth);
```

#### Basic Authentication

```typescript
const auth = new BasicAuthStrategy(() => ({
	username: "admin",
	password: "secret",
}));
const client = new HttpClient("https://api.example.com", auth);
```

#### Per-Request Authentication

```typescript
// Override auth for specific requests
await client
	.get("/admin/users")
	.auth(new BearerAuthStrategy(() => getAdminToken()))
	.data();

// Skip auth for public endpoints
await client.get("/public/info").noAuth().data();
```

### Retry Strategies

Built-in smart retry logic:

```typescript
// Simple retry
await client.get("/flaky-endpoint").retry({ attempts: 3, delay: 1000 }).data();

// Exponential backoff
await client
	.post("/important")
	.json(data)
	.retry({
		attempts: 5,
		strategy: new ExponentialBackoffRetryStrategy(5, 1000, 30000),
	})
	.data();
```

### Development Features

#### Mock Responses

Perfect for testing and development:

```typescript
// Mock a specific request
const mockData = await client
	.get("/users")
	.mock({
		data: [{ id: 1, name: "Test User" }],
		status: 200,
		delay: 500,
	})
	.data();

// Global mock mode
const mockClient = client.withMock(true);
```

#### Request Caching

Automatic deduplication of identical parallel requests:

```typescript
// These requests will be deduplicated
const [user1, user2] = await Promise.all([
	client.get("/user/123").cache(true).data(),
	client.get("/user/123").cache(true).data(), // Same request, cached
]);
```

#### Request Caching

Automatic deduplication of identical parallel requests:

```typescript
// These requests will be deduplicated - only ONE HTTP request is made!
const [user1, user2, user3] = await Promise.all([
  client.get('/user/123').cache(true).data(),
  client.get('/user/123').cache(true).data(), // Same request, uses cached Promise
  client.get('/user/123').cache(true).data()  // Same request, uses cached Promise
]);

console.log(user1 === user2 === user3); // true - same object reference!

// Cache works for identical requests (same URL, headers, body)
const [posts1, posts2] = await Promise.all([
  client.get('/posts').params({ page: 1 }).cache(true).data(),
  client.get('/posts').params({ page: 1 }).cache(true).data() // Deduplicated!
]);

// Different parameters = different cache keys = separate requests
const [page1, page2] = await Promise.all([
  client.get('/posts').params({ page: 1 }).cache(true).data(), // Request 1
  client.get('/posts').params({ page: 2 }).cache(true).data()  // Request 2
]);
```

## Advanced Usage

### Error Handling

```typescript
try {
	const data = await client.get("/api/data").data();
} catch (error) {
	if (error.status === 401) {
		// Handle unauthorized
	} else if (error.status >= 500) {
		// Handle server errors
	}
}
```

### File Uploads

```typescript
const formData = new FormData();
formData.append("file", fileInput.files[0]);
formData.append("description", "My upload");

const result = await client
	.post("/upload")
	.form(formData)
	.timeout(30000)
	.data();
```

### Custom Headers and Options

```typescript
const response = await client
	.get("/api/data")
	.headers({
		"Accept-Language": "en-US",
		"X-Custom-Header": "value",
	})
	.timeout(10000)
	.execute();
```

## TypeScript Support

Full type safety for requests and responses:

```typescript
interface User {
	id: number;
	name: string;
	email: string;
}

interface ApiResponse<T> {
	data: T[];
	total: number;
	page: number;
}

// Typed response
const users = await client
	.get("/users")
	.params({ page: 1 })
	.data<ApiResponse<User>>();

// users is fully typed as ApiResponse<User>
console.log(users.data[0].name); // TypeScript knows this is a string
```

## API Reference

### HttpClient Constructor

```typescript
new HttpClient(
  baseUrl: string,
  authStrategy?: AuthStrategy | null,  // null = explicitly no auth
  options?: HttpClientOptions
)
```

### Request Methods

- `get(path: string): EndpointBuilder`
- `post(path: string): EndpointBuilder`
- `put(path: string): EndpointBuilder`
- `patch(path: string): EndpointBuilder`
- `delete(path: string): EndpointBuilder`
- `head(path: string): EndpointBuilder`
- `requestOptions(path: string): EndpointBuilder`

### EndpointBuilder Methods

#### Configuration

- `params(params: Record<string, any>): this`
- `headers(headers: Record<string, string>): this`
- `header(name: string, value: string): this`
- `timeout(ms: number): this`

#### Body

- `json(data: any): this`
- `form(data: FormData | Record<string, any>): this`
- `urlencoded(data: Record<string, any>): this`
- `body(data: any): this`

#### Features

- `auth(strategy: AuthStrategy | null): this`
- `noAuth(): this`
- `retry(config: RetryConfig): this`
- `mock(response: MockResponse): this`
- `cache(enabled?: boolean): this`

#### Execution

- `execute<T>(): Promise<HttpResponse<T>>` - Returns full response
- `data<T>(): Promise<T>` - Returns only response data

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Anton Ryuben** - [developer@myraxbyte.dev](mailto:developer@myraxbyte.dev)
