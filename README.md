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

### 🚀 Universal API - One Client for All Use Cases

```typescript
import { createClient } from "@cordy/endpoint-builder";

// Simple usage
const api = createClient({
	baseUrl: "https://api.example.com",
	auth: "your-token-here", // Auto-detects Bearer token
});

const users = await api.get("/users");
const newUser = await api.post("/users", {
	name: "John",
	email: "john@example.com",
});
```

### 🔧 Advanced Configuration in the Same Client

```typescript
import {
	createClient,
	ApiKeyStrategy,
	JitteredExponentialBackoffRetryStrategy,
} from "@cordy/endpoint-builder";

const api = createClient({
	baseUrl: "https://api.example.com",

	// Simple options
	timeout: 10000,
	retry: true,
	headers: { "X-App": "MyApp" },

	// Advanced options
	authStrategy: new ApiKeyStrategy("Custom-Header", "secret"),
	retryStrategy: new JitteredExponentialBackoffRetryStrategy(5, 1000, 30000),
	dedupe: true,
});

// Simple methods
const users = await api.get("/users");

// Advanced methods on the same client
const response = await api
	.request("GET", "/advanced")
	.timeout(30000)
	.header("X-Special", "value")
	.send();

// Full HttpClient access when needed
const fullControl = await api.httpClient.get("/complex").retry(null).data();
```

**[📖 See full Quick Start Guide](./docs/QUICK_START.md)** for comprehensive examples.

## HTTP Methods

All methods are available through the unified `createClient()` API:

### Basic Usage

```typescript
import { createClient } from "@cordy/endpoint-builder";

const api = createClient({ baseUrl: "https://api.example.com" });

// GET requests
const user = await api.get("/users/1");
const users = await api.get("/users", { query: { page: 2, limit: 20 } });

// POST requests
const created = await api.post("/users", {
	name: "Jane",
	email: "jane@example.com",
});

// PUT/PATCH requests
const updated = await api.put("/users/1", { name: "Jane Updated" });
const patched = await api.patch("/users/1", { name: "Jane Patched" });

// DELETE requests
const deleted = await api.delete("/users/1");

// Get full response instead of just data
const response = await api.response("GET", "/users/1");
console.log(response.status); // 200
console.log(response.data); // User object
```

### File Operations

```typescript
// File upload (simple)
const fileData = new FormData();
fileData.append("file", fileInput.files[0]);
const uploaded = await api.post("/upload", fileData);

// File download
const fileBlob = await api.get("/files/document.pdf", {
	headers: { Accept: "application/pdf" },
});
```

### Advanced Usage with RequestBuilder

For fine-grained control, use the `.request()` method:

```typescript
// Advanced request with precise control
const response = await api
	.request("POST", "/users")
	.timeout(5000)
	.header("X-Custom", "value")
	.body({ name: "John", email: "john@example.com" })
	.send();

// File upload with custom headers
const uploaded = await api
	.request("POST", "/upload")
	.timeout(30000)
	.header("X-Upload-Type", "document")
	.body(formData)
	.send();
```

### Expert Level - Direct HttpClient Access

When you need maximum control:

```typescript
// Access the underlying HttpClient
const client = api.httpClient;

// Full control over the request
const user = await client
	.get("/users/1")
	.dedupe(false)
	.retry(null)
	.responseType("json")
	.data();

// Complex authentication override
const data = await client
	.post("/secure")
	.authStrategy(customAuthStrategy)
	.json({ sensitive: "data" })
	.data();
```

## Authentication

### Simple Authentication (Auto-Detection)

The unified API automatically detects common authentication patterns:

```typescript
import { createClient } from "@cordy/endpoint-builder";

// Bearer token (auto-detected)
const api = createClient({
	baseUrl: "https://api.example.com",
	auth: "your-token-here", // Automatically becomes "Bearer your-token-here"
});

// API key (auto-detected)
const api = createClient({
	baseUrl: "https://api.example.com",
	apiKey: "your-api-key", // Automatically becomes "X-API-Key: your-api-key"
});

// Custom headers
const api = createClient({
	baseUrl: "https://api.example.com",
	headers: {
		Authorization: "Custom your-token",
		"X-Custom-Auth": "secret",
	},
});
```

### Advanced Authentication Strategies

For complex scenarios, use explicit strategies:

```typescript
import {
	createClient,
	ApiKeyStrategy,
	OpaqueTokenStrategy,
	LocalStoragePersist,
} from "@cordy/endpoint-builder";

// Custom API key strategy
const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new ApiKeyStrategy("X-Custom-API-Key", "your-key"),
});

// API key as query parameter
const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new ApiKeyStrategy("apikey", "your-key", true), // true = query param
});

// Token with auto-refresh
const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new OpaqueTokenStrategy(
		new LocalStoragePersist(), // Storage for tokens
		"https://api.example.com/auth/refresh", // Refresh endpoint
	),
});

// The strategy expects tokens in format: { access: string, refresh?: string }
// Refresh endpoint should accept POST { token: "refresh_token" }
// and return { access: "new_access", refresh?: "new_refresh" }
```

### Custom Authentication

```typescript
import { createClient, AuthStrategy } from "@cordy/endpoint-builder";

class HMACAuthStrategy implements AuthStrategy {
	async enrichRequest(req: Request): Promise<Partial<HttpHeaders>> {
		const timestamp = Date.now().toString();
		const signature = await this.sign(req, timestamp);

		return {
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		};
	}

	async handleRequestError(req: Request, res: Response): Promise<boolean> {
		// Return true to retry the request
		return false;
	}

	private async sign(req: Request, timestamp: string): Promise<string> {
		// Your HMAC signing logic here
		return "signature";
	}

	// ============================================
	// DEPRECATED METHODS (for backward compatibility)
	// ============================================

	/** @deprecated Use enrichRequest() instead */
	async enrich(req: Request): Promise<Partial<HttpHeaders>> {
		return this.enrichRequest(req);
	}

	/** @deprecated Use handleRequestError() instead */
	async refresh(req: Request, res: Response): Promise<boolean> {
		return this.handleRequestError(req, res);
	}
}

// Use custom strategy
const api = createClient({
	baseUrl: "https://api.example.com",
	authStrategy: new HMACAuthStrategy(),
});
```

## Retry Strategies

Configure retry behavior for resilient applications:

```typescript
import {
	createClient,
	JitteredExponentialBackoffRetryStrategy,
} from "@cordy/endpoint-builder";

// Simple retry configuration
const api = createClient({
	baseUrl: "https://api.example.com",
	retry: 3, // Auto-creates retry strategy with 3 attempts
});

// Advanced retry strategy
const api = createClient({
	baseUrl: "https://api.example.com",
	retryStrategy: new JitteredExponentialBackoffRetryStrategy(
		5, // maxAttempts (default: 3)
		500, // baseDelay in ms (default: 300)
		30000, // maxDelay in ms (default: 10000)
	),
});

// Disable retry for specific request
const data = await api.request("POST", "/critical").timeout(5000).send();
```

The default retry strategy retries on:

- Network errors (no response)
- 5xx server errors
- 429 Too Many Requests

## Request Configuration

### Timeout

```typescript
// Global timeout in createClient
const api = createClient({
	baseUrl: "https://api.example.com",
	timeout: 10000, // 10 seconds default
});

// Override timeout for specific request
const data = await api
	.request("GET", "/slow-endpoint")
	.timeout(30000) // 30 seconds for this request
	.send();
```

### Abort Signal

```typescript
const controller = new AbortController();

// Using simple API
const promise = api.get("/large-data", {
	signal: controller.signal,
});

// Using advanced API
const promise = api
	.request("GET", "/large-data")
	.signal(controller.signal)
	.send();

// Cancel request after 5 seconds
setTimeout(() => controller.abort(), 5000);
```

### Response Types

```typescript
// Default: auto-detect based on Content-Type
const data = await api.get("/api/data");

// Force specific response type using advanced API
const text = await api.httpClient.get("/file.txt").responseType("text").data();

const blob = await api.httpClient.get("/image.jpg").responseType("blob").data();

const buffer = await api.httpClient
	.get("/binary")
	.responseType("arraybuffer")
	.data();

const stream = await api.httpClient
	.get("/large-file")
	.responseType("stream")
	.data();
```

### Request Deduplication

Prevents multiple identical requests from being sent simultaneously:

```typescript
// Enable globally
const api = createClient({
	baseUrl: "https://api.example.com",
	dedupe: true
});
});

// Control deduplication for specific requests using advanced API
const data = await api.httpClient.get("/data").dedupe(true).data();

// These will return the same promise when dedupe is enabled
const p1 = api.get("/users");
const p2 = api.get("/users");
console.log(p1 === p2); // true if dedupe is enabled
```

````

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
````

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

The library throws detailed errors for failed requests:

```typescript
try {
	const data = await api.get("/users/999");
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

The library provides excellent TypeScript support with type inference:

```typescript
interface User {
	id: number;
	name: string;
	email: string;
}

// Response is automatically typed as User
const user = await api.get<User>("/users/1");

// Request body is type-checked
interface CreateUserDto {
	name: string;
	email: string;
}

const newUser = await api.post<User>("/users", {
	name: "John", // ✅ Type-checked
	email: "john@example.com", // ✅ Type-checked
	// invalid: "field" // ❌ Would cause TypeScript error
});

// Advanced API also supports generics
const user = await api.httpClient.get<User>("/users/1").data();
```

## Advanced Usage

### Creating a Custom API Client

```typescript
import { createClient, ApiKeyStrategy } from "@cordy/endpoint-builder";

class MyApiClient {
	private api;

	constructor(private apiKey: string) {
		this.api = createClient({
			baseUrl: "https://api.myservice.com",
			authStrategy: new ApiKeyStrategy("X-API-Key", apiKey),
			headers: {
				Accept: "application/json"
			}
			},
		});
	}

	async getUsers(page = 1): Promise<User[]> {
		return this.api.get<User[]>("/users", {
			query: { page, limit: 20 }
		});
	}

	async createUser(data: CreateUserDto): Promise<User> {
		return this.api.post<User>("/users", data);
	}

	async updateUser(id: number, data: Partial<User>): Promise<User> {
		return this.api.patch<User>(`/users/${id}`, data);
	}

	async deleteUser(id: number): Promise<void> {
		await this.api.delete(`/users/${id}`);
	}
}
```

### Using with React

```typescript
import { useEffect, useState } from "react";
import { createClient } from "@cordy/endpoint-builder";

const api = createClient({
	baseUrl: "https://api.example.com"
});

function useApi<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    api.get<T>(path, {
      signal: controller.signal
    })
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

### Using with TanStack Query

Perfect integration with TanStack Query for powerful data fetching:

```typescript
import { createClient } from "@cordy/endpoint-builder";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const api = createClient({
  baseUrl: "https://api.example.com",
  auth: "your-token"
});

// Query functions
const userQueries = {
  all: () => ['users'] as const,
  lists: () => [...userQueries.all(), 'list'] as const,
  list: (filters: string) => [...userQueries.lists(), { filters }] as const,
  details: () => [...userQueries.all(), 'detail'] as const,
  detail: (id: number) => [...userQueries.details(), id] as const,
};

// Fetch user list
function useUsers() {
  return useQuery({
    queryKey: userQueries.lists(),
    queryFn: () => api.get<User[]>("/users")
  });
}

// Fetch single user
function useUser(id: number) {
  return useQuery({
    queryKey: userQueries.detail(id),
    queryFn: () => api.get<User>(`/users/${id}`),
    enabled: !!id
  });
}

// Create user mutation
function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserDto) => api.post<User>("/users", data),
    onSuccess: () => {
      // Invalidate and refetch users list
      queryClient.invalidateQueries({ queryKey: userQueries.lists() });
    }
  });
}

// Update user mutation
function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) =>
      api.patch<User>(`/users/${id}`, data),
    onSuccess: (_, { id }) => {
      // Invalidate specific user and users list
      queryClient.invalidateQueries({ queryKey: userQueries.detail(id) });
      queryClient.invalidateQueries({ queryKey: userQueries.lists() });
    }
  });
}

// Delete user mutation
function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      // Invalidate users list after deletion
      queryClient.invalidateQueries({ queryKey: userQueries.lists() });
    }
  });
}

// Usage in component
function UserList() {
  const { data: users, isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const handleCreate = () => {
    createUser.mutate({
      name: "New User",
      email: "user@example.com"
    });
  };

  const handleUpdate = (id: number) => {
    updateUser.mutate({
      id,
      data: { name: "Updated Name" }
    });
  };

  const handleDelete = (id: number) => {
    deleteUser.mutate(id);
  };

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  return (
    <div>
      <button onClick={handleCreate}>Create User</button>
      {users?.map(user => (
        <div key={user.id}>
          {user.name}
          <button onClick={() => handleUpdate(user.id)}>Update</button>
          <button onClick={() => handleDelete(user.id)}>Delete</button>
        </div>
      ))}
    </div>
  );
}

// Advanced: Error handling and optimistic updates
function useCreateUserOptimistic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserDto) => api.post<User>("/users", data),
    onMutate: async (newUser) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: userQueries.lists() });

      // Snapshot previous value
      const previousUsers = queryClient.getQueryData(userQueries.lists());

      // Optimistically update
      queryClient.setQueryData(userQueries.lists(), (old: User[] = []) => [
        ...old,
        { id: Date.now(), ...newUser } // Temporary ID
      ]);

      return { previousUsers };
    },
    onError: (err, newUser, context) => {
      // Rollback on error
      queryClient.setQueryData(userQueries.lists(), context?.previousUsers);
    },
    onSettled: () => {
      // Always refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: userQueries.lists() });
    }
  });
}

// Background refetching for fresh data
function useUsersWithBackground() {
  return useQuery({
    queryKey: userQueries.lists(),
    queryFn: () => api.get<User[]>("/users"),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
    refetchOnWindowFocus: true,
  });
}
```

## API Reference

For detailed API documentation, see [API.md](./docs/API.md).

For more examples, see [EXAMPLES.md](./docs/EXAMPLES.md).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
