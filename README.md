# endpoint-builder

A modern, lightweight HTTP client for TypeScript and JavaScript applications with zero dependencies. Built on the native Fetch API with powerful features for real-world applications.

[![npm version](https://img.shields.io/npm/v/@cordy/endpoint-builder.svg)](https://www.npmjs.com/package/@cordy/endpoint-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## Features

- 🚀 **Zero Dependencies** - Built on native Fetch API
- 🔒 **Type Safe** - Full TypeScript support with generics
- 🔄 **Smart Retries** - Configurable exponential backoff with jitter
- 🎯 **Request Deduplication** - Automatic deduplication of identical requests
- 🔐 **Authentication** - Pluggable auth strategies with automatic token refresh
- 💾 **Flexible Storage** - Pluggable storage backends for tokens and data
- ⚡ **Modern API** - Async/await and method chaining
- 🎨 **Clean Architecture** - Separation of concerns with strategies pattern

## Installation

```bash
npm install @cordy/endpoint-builder
```

```bash
yarn add @cordy/endpoint-builder
```

```bash
pnpm add @cordy/endpoint-builder
```

## Quick Start

```typescript
import { HttpClient } from "@cordy/endpoint-builder";

// Create a client instance
const client = new HttpClient({
	baseUrl: "https://api.example.com",
});

// Make requests
const users = await client.get("/users").data();
const newUser = await client.post("/users").json({ name: "John" }).data();
```

## Core Concepts

### HttpClient

The main class for making HTTP requests. Create an instance with your configuration:

```typescript
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	defaultHeaders: {
		Accept: "application/json",
		"X-App-Version": "1.0.0",
	},
	dedupe: true, // Enable request deduplication
	retryStrategy: new JitteredExponentialBackoffRetryStrategy(3, 300, 10000),
});
```

### Request Builder

All HTTP methods return a `RequestBuilder` instance that allows you to chain methods for configuring the request:

```typescript
const response = await client
	.get("/users") // HTTP method and path
	.query({ page: 1, limit: 10 }) // Query parameters
	.header("X-Request-ID", "123") // Add header
	.timeout(5000) // Set timeout
	.retry(customRetryStrategy) // Override retry strategy
	.dedupe() // Enable deduplication
	.send(); // Execute and get full response

// Or get just the data
const data = await client.get("/users").data();
```

## HTTP Methods

### GET Requests

```typescript
// Simple GET
const user = await client.get("/users/1").data();

// With query parameters
const users = await client.get("/users").query({ page: 2, limit: 20 }).data();

// With custom headers
const data = await client
	.get("/protected")
	.header("Authorization", "Bearer token")
	.data();
```

### POST Requests

```typescript
// JSON body (Content-Type set automatically)
const created = await client
	.post("/users")
	.json({ name: "Jane", email: "jane@example.com" })
	.data();

// Form data
const formData = new FormData();
formData.append("file", fileInput.files[0]);
formData.append("name", "Document");

const uploaded = await client.post("/upload").body(formData).data();

// URL-encoded form
const result = await client
	.post("/form")
	.form({ username: "john", password: "secret" })
	.data();
```

### PUT and PATCH Requests

```typescript
// Full update
const updated = await client
	.put("/users/1")
	.json({ id: 1, name: "John Updated", email: "john@example.com" })
	.data();

// Partial update
const patched = await client
	.patch("/users/1")
	.json({ name: "John Updated" })
	.data();
```

### DELETE Requests

```typescript
const response = await client.delete("/users/1").send();
console.log(response.status); // 200 or 204
```

## Authentication

### API Key Authentication

```typescript
import { HttpClient, ApiKeyStrategy } from "@cordy/endpoint-builder";

// API key in header
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("X-API-Key", "your-api-key"),
});

// API key as query parameter
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("apikey", "your-api-key", true),
});

// Bearer token
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new ApiKeyStrategy("Authorization", "Bearer your-token"),
});
```

### Token Authentication with Auto-Refresh

```typescript
import {
	HttpClient,
	OpaqueTokenStrategy,
	LocalStoragePersist,
} from "@cordy/endpoint-builder";

const client = new HttpClient({
	baseUrl: "https://api.example.com",
	auth: new OpaqueTokenStrategy(
		new LocalStoragePersist(), // Storage backend
		"https://api.example.com/auth/refresh", // Refresh endpoint
		"Authorization", // Header name (optional, default: "Authorization")
	),
});

// The strategy expects tokens in format: { access: string, refresh?: string }
// Refresh endpoint should accept POST { token: "refresh_token" }
// and return { access: "new_access", refresh?: "new_refresh" }
```

### Custom Authentication

```typescript
import { AuthStrategy } from "@cordy/endpoint-builder";

class HMACAuthStrategy implements AuthStrategy {
	async enrich(req: Request): Promise<Partial<HttpHeaders>> {
		const timestamp = Date.now().toString();
		const signature = await this.sign(req, timestamp);

		return {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		};
	}

	async refresh(req: Request, res: Response): Promise<boolean> {
		// Return true to retry the request
		return false;
	}

	private async sign(req: Request, timestamp: string): Promise<string> {
		// Your HMAC signing logic here
		return "signature";
	}
}
```

## Retry Strategies

The library includes a sophisticated retry mechanism with exponential backoff and jitter:

```typescript
import { JitteredExponentialBackoffRetryStrategy } from "@cordy/endpoint-builder";

const retryStrategy = new JitteredExponentialBackoffRetryStrategy(
	5, // maxAttempts (default: 3)
	500, // baseDelay in ms (default: 300)
	30000, // maxDelay in ms (default: 10000)
);

const client = new HttpClient({
	baseUrl: "https://api.example.com",
	retryStrategy,
});

// Disable retry for specific request
await client.post("/critical").retry(null).json(data).data();
```

The default retry strategy retries on:

- Network errors (no response)
- 5xx server errors
- 429 Too Many Requests

## Request Configuration

### Timeout

```typescript
// Set timeout for specific request
const data = await client
	.get("/slow-endpoint")
	.timeout(10000) // 10 seconds
	.data();
```

### Abort Signal

```typescript
const controller = new AbortController();

// Start request
const promise = client.get("/large-data").signal(controller.signal).data();

// Cancel request
setTimeout(() => controller.abort(), 5000);
```

### Response Types

```typescript
// JSON (default)
const json = await client.get("/api/data").data();

// Text
const text = await client.get("/file.txt").responseType("text").data();

// Blob
const blob = await client.get("/image.jpg").responseType("blob").data();

// ArrayBuffer
const buffer = await client.get("/binary").responseType("arraybuffer").data();

// Stream
const stream = await client.get("/large-file").responseType("stream").data();
```

### Request Deduplication

Prevents multiple identical requests from being sent simultaneously:

```typescript
// Enable globally
const client = new HttpClient({
	baseUrl: "https://api.example.com",
	dedupe: true,
});

// Enable for specific request
const data = await client.get("/data").dedupe().data();

// These will return the same promise
const p1 = client.get("/users").dedupe().data();
const p2 = client.get("/users").dedupe().data();
console.log(p1 === p2); // true
```

## Storage

The library provides pluggable storage backends for persisting data like authentication tokens:

### LocalStoragePersist

Uses browser's localStorage:

```typescript
import { LocalStoragePersist } from "@cordy/endpoint-builder";

const storage = new LocalStoragePersist();
await storage.set("key", { data: "value" });
const value = await storage.get("key");
await storage.delete("key");
```

### MemoryStoragePersist

In-memory storage (data is lost on page reload):

```typescript
import { MemoryStoragePersist } from "@cordy/endpoint-builder";

const storage = new MemoryStoragePersist();
```

### Custom Storage

Implement the `PersistStorage` interface:

```typescript
import { PersistStorage } from "@cordy/endpoint-builder";

class CustomStorage implements PersistStorage {
	async get<T>(key: string): Promise<T | undefined> {
		// Your implementation
	}

	async set<T>(key: string, value: T): Promise<void> {
		// Your implementation
	}

	async delete(key: string): Promise<void> {
		// Your implementation
	}
}
```

## Error Handling

The library throws `HttpError` for failed requests:

```typescript
try {
	const data = await client.get("/users/999").data();
} catch (error) {
	if (error.response) {
		// Server responded with error status
		console.error("Status:", error.status);
		console.error("Response:", error.response.data);
	} else if (error.config) {
		// Request made but no response (network error)
		console.error("Network error:", error.message);
	} else {
		// Request setup error
		console.error("Error:", error.message);
	}
}
```

## TypeScript Support

The library is written in TypeScript and provides excellent type inference:

```typescript
interface User {
	id: number;
	name: string;
	email: string;
}

// Response is typed as User
const user = await client.get<User>("/users/1").data();

// Request body is typed
interface CreateUserDto {
	name: string;
	email: string;
}

const newUser = await client
	.post<User, CreateUserDto>("/users")
	.json({ name: "John", email: "john@example.com" }) // Type-checked
	.data();
```

## Advanced Usage

### Creating a Custom API Client

```typescript
class MyApiClient {
	private client: HttpClient;

	constructor(private apiKey: string) {
		this.client = new HttpClient({
			baseUrl: "https://api.myservice.com",
			auth: new ApiKeyStrategy("X-API-Key", apiKey),
			defaultHeaders: {
				Accept: "application/json",
			},
		});
	}

	async getUsers(page = 1): Promise<User[]> {
		return this.client
			.get<User[]>("/users")
			.query({ page, limit: 20 })
			.data();
	}

	async createUser(data: CreateUserDto): Promise<User> {
		return this.client.post<User>("/users").json(data).data();
	}

	async updateUser(id: number, data: Partial<User>): Promise<User> {
		return this.client.patch<User>(`/users/${id}`).json(data).data();
	}

	async deleteUser(id: number): Promise<void> {
		await this.client.delete(`/users/${id}`).send();
	}
}
```

### Using with React

```typescript
import { useEffect, useState } from "react";
import { HttpClient } from "@cordy/endpoint-builder";

const client = new HttpClient({
  baseUrl: "https://api.example.com"
});

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    client
      .get<T>(path)
      .signal(controller.signal)
      .data()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [path]);

  return { data, loading, error };
}

// Usage
function UserProfile({ userId }: { userId: number }) {
  const { data: user, loading, error } = useApi<User>(`/users/${userId}`);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return <div>{user?.name}</div>;
}
```

## API Reference

For detailed API documentation, see [API.md](./docs/API.md).

For more examples, see [EXAMPLES.md](./docs/EXAMPLES.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
