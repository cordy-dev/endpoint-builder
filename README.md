# endpoint-builder

A modern, type-safe HTTP client for TypeScript with runtime validation. Built on the native Fetch API with zero dependencies.

[![npm version](https://img.shields.io/npm/v/@cordy/endpoint-builder.svg)](https://www.npmjs.com/package/@cordy/endpoint-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## Features

- **Type-Safe Path Parameters** - Auto-extract params from URL strings like `/users/:id`
- **Runtime Validation** - Validate responses with Standard Schema (zod, valibot, arktype)
- **Safe Mode** - Rust-inspired Result type with `.safe()` for error handling
- **Auth Helpers** - Built-in helpers for Bearer, API Key, Basic, and Refresh Token auth
- **Response Unwrapping** - Global and per-request unwrap for wrapped API responses
- **Transform Chains** - Type-safe data transformations after validation
- **Smart Retries** - Configurable exponential backoff with jitter
- **Request Deduplication** - Automatic deduplication of identical requests
- **Zero Dependencies** - Built on native Fetch API

## Installation

```bash
npm install @cordy/endpoint-builder
```

```bash
pnpm add @cordy/endpoint-builder
```

## Quick Start

```typescript
import { createClient } from "@cordy/endpoint-builder";

const api = createClient({
  baseUrl: "https://api.example.com",
  auth: "your-token-here",
});

// Type-safe path parameters
const user = await api
  .get("/users/:id", { params: { id: 1 } }) // TypeScript enforces params!
  .data();

// Create a user
const newUser = await api
  .post("/users", { body: { name: "John", email: "john@example.com" } })
  .data();
```

## Type-Safe Path Parameters

Path parameters are automatically extracted from URL strings:

```typescript
// TypeScript requires params: { id: string | number }
const user = await api
  .get("/users/:id", { params: { id: 123 } })
  .data();

// Multiple params - all required!
const comment = await api
  .get("/posts/:postId/comments/:commentId", {
    params: { postId: 1, commentId: 5 }
  })
  .data();

// No params needed for static paths
const users = await api.get("/users").data();
```

## Schema Validation with Standard Schema

Validate responses at runtime using any Standard Schema compatible library (zod, valibot, arktype):

```typescript
import { createClient } from "@cordy/endpoint-builder";
import { z } from "zod";

const api = createClient({ baseUrl: "https://api.example.com" });

// Define your schema
const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

// Validate response - throws ValidationError if invalid
const user = await api
  .get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema); // Type inferred from schema!

// user is typed as { id: number; name: string; email: string }
console.log(user.name);
```

### Using with Valibot

```typescript
import * as v from "valibot";

const UserSchema = v.object({
  id: v.number(),
  name: v.string(),
  email: v.pipe(v.string(), v.email()),
});

const user = await api
  .get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema);
```

## Safe Mode - Error Handling

Use `.safe()` for Result-style error handling instead of throwing:

```typescript
const result = await api
  .get("/users/:id", { params: { id: 999 } })
  .schema(UserSchema)
  .safe();

if (result.error) {
  // Handle error (ValidationError, HttpError, or network error)
  console.error("Failed:", result.error.message);
  return;
}

// TypeScript knows result.data is defined here
console.log(result.data.name);
```

### Error Types

```typescript
import { ValidationError, HttpError } from "@cordy/endpoint-builder";

const result = await api.get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema)
  .safe();

if (result.error) {
  if (result.error instanceof ValidationError) {
    // Response didn't match schema
    console.error("Invalid data:", result.error.issues);
  } else if ((result.error as HttpError).status) {
    // HTTP error (4xx, 5xx)
    const httpError = result.error as HttpError;
    console.error(`HTTP ${httpError.status}:`, httpError.statusText);
  } else {
    // Network error
    console.error("Network error:", result.error.message);
  }
}
```

## Authentication

### Simple Auth Options

```typescript
// Bearer token
const api = createClient({
  baseUrl: "https://api.example.com",
  auth: "your-token", // Becomes "Bearer your-token"
});

// API Key
const api = createClient({
  baseUrl: "https://api.example.com",
  apiKey: "your-api-key", // Becomes "X-API-Key: your-api-key"
});
```

### Auth Helpers

For more control, use the built-in auth helpers:

```typescript
import { createClient, bearerAuth, basicAuth, apiKeyAuth, refreshAuth } from "@cordy/endpoint-builder";

// Bearer token (static or dynamic)
const api = createClient({
  baseUrl: "https://api.example.com",
  authStrategy: bearerAuth("my-token"),
});

// Dynamic token (called on each request)
const api = createClient({
  baseUrl: "https://api.example.com",
  authStrategy: bearerAuth(() => getTokenFromStore()),
});

// Basic authentication
const api = createClient({
  baseUrl: "https://api.example.com",
  authStrategy: basicAuth("username", "password"),
});

// API key with custom header
const api = createClient({
  baseUrl: "https://api.example.com",
  authStrategy: apiKeyAuth("my-key", "X-Custom-Key"),
});

// Refresh token with auto-refresh on 401
const api = createClient({
  baseUrl: "https://api.example.com",
  authStrategy: refreshAuth({
    getToken: () => localStorage.getItem("access_token") || "",
    getRefreshToken: () => localStorage.getItem("refresh_token") || "",
    refresh: async (refreshToken) => {
      const response = await fetch("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ token: refreshToken }),
      });
      const { accessToken } = await response.json();
      localStorage.setItem("access_token", accessToken);
      return accessToken;
    },
    shouldRefresh: (response) => response.status === 401, // Optional, default is 401
  }),
});
```

## Response Unwrapping

Many APIs wrap responses in a data envelope. Use unwrap to extract the data:

```typescript
// API returns { data: { id: 1, name: "John" }, meta: { timestamp: "..." } }

const api = createClient({
  baseUrl: "https://api.example.com",
  unwrap: (response) => response.data, // Extract data globally
});

// Now you get the unwrapped data directly
const user = await api
  .get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema);

// user is { id: 1, name: "John" }, not wrapped

// Disable unwrap for specific requests
const fullResponse = await api
  .get("/users/:id", { params: { id: 1 } })
  .unwrap(false)
  .data();
// fullResponse is { data: {...}, meta: {...} }
```

## Transform Chains

Transform validated data with type-safe chains:

```typescript
// Extract just the email from a validated user
const email = await api
  .get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema)
  .transform((user) => user.email);

// Transform paginated response to array of names
const PaginatedSchema = z.object({
  users: z.array(z.object({ id: z.number(), name: z.string() })),
  total: z.number(),
});

const names = await api
  .get("/users")
  .schema(PaginatedSchema)
  .transform((response) => response.users.map((u) => u.name));
// names is string[]
```

## HTTP Methods

```typescript
// GET
const user = await api.get("/users/:id", { params: { id: 1 } }).data();
const users = await api.get("/users", { query: { page: 1, limit: 10 } }).data();

// POST
const newUser = await api
  .post("/users", { body: { name: "John" } })
  .data();

// PUT
const updated = await api
  .put("/users/:id", { params: { id: 1 }, body: { name: "Updated" } })
  .data();

// PATCH
const patched = await api
  .patch("/users/:id", { params: { id: 1 }, body: { name: "Patched" } })
  .data();

// DELETE
await api.delete("/users/:id", { params: { id: 1 } }).send();

// HEAD
await api.head("/users/:id", { params: { id: 1 } }).send();

// OPTIONS
const options = await api.options("/users").data();
```

## Request Options

### Query Parameters

```typescript
const users = await api.get("/users", {
  query: {
    page: 2,
    limit: 20,
    sort: "name",
    filter: ["active", "verified"],
  }
}).data();
```

### Custom Headers

```typescript
// Per-request headers
const data = await api.get("/data", {
  headers: { "X-Request-ID": "abc123" }
}).data();

// Global default headers
const api = createClient({
  baseUrl: "https://api.example.com",
  headers: {
    "X-Client-Version": "1.0",
    "Accept-Language": "en-US",
  },
});
```

### Timeout

```typescript
// Global timeout
const api = createClient({
  baseUrl: "https://api.example.com",
  timeout: 10000, // 10 seconds
});

// Per-request timeout
const data = await api.get("/slow", { timeout: 30000 }).data();
```

## Retry Strategy

```typescript
import { createClient, ExponentialRetryStrategy } from "@cordy/endpoint-builder";

// Simple retry (uses default exponential backoff)
const api = createClient({
  baseUrl: "https://api.example.com",
  retry: true,
});

// Custom retry strategy
const api = createClient({
  baseUrl: "https://api.example.com",
  retryStrategy: new ExponentialRetryStrategy({
    maxAttempts: 5,
    baseDelay: 500,
    maxDelay: 30000,
  }),
});

// Disable retry for specific request
const data = await api.get("/no-retry")
  .retry(null)
  .data();
```

## Request Deduplication

Prevents duplicate concurrent requests:

```typescript
const api = createClient({
  baseUrl: "https://api.example.com",
  dedupe: true,
});

// These return the same promise (single HTTP request)
const p1 = api.get("/users").data();
const p2 = api.get("/users").data();
const [users1, users2] = await Promise.all([p1, p2]);
// users1 === users2, only one HTTP request made
```

## Interceptors

```typescript
const api = createClient({
  baseUrl: "https://api.example.com",
  requestInterceptors: [
    {
      async onRequest(config) {
        // Modify request before sending
        config.headers["X-Timestamp"] = Date.now().toString();
        return config;
      },
    },
  ],
  responseInterceptors: [
    {
      async onResponse(response) {
        // Process response
        console.log(`Response ${response.status}`);
        return response;
      },
      async onError(error) {
        // Handle errors
        console.error("Request failed:", error.message);
        return error;
      },
    },
  ],
});
```

## Full Configuration

```typescript
import {
  createClient,
  bearerAuth,
  ExponentialRetryStrategy,
  MemoryStoragePersist,
} from "@cordy/endpoint-builder";

const api = createClient({
  // Base URL for all requests
  baseUrl: "https://api.example.com",

  // Default headers for all requests
  headers: {
    "Accept": "application/json",
    "X-Client-Version": "1.0",
  },

  // Authentication (simple option)
  auth: "your-token",
  // Or API key
  apiKey: "your-api-key",
  // Or custom strategy (overrides auth/apiKey)
  authStrategy: bearerAuth(() => getToken()),

  // Request timeout in milliseconds
  timeout: 10000,

  // Enable request deduplication
  dedupe: true,

  // Enable retry (uses default strategy)
  retry: true,
  // Or custom retry strategy
  retryStrategy: new ExponentialRetryStrategy({
    maxAttempts: 3,
    baseDelay: 300,
    maxDelay: 10000,
  }),

  // Default response type
  responseType: "json",

  // Custom storage for auth tokens
  storage: new MemoryStoragePersist(),

  // Global response unwrap function
  unwrap: (response) => response.data,

  // Request/response interceptors
  requestInterceptors: [],
  responseInterceptors: [],
});
```

## TypeScript Support

Full type inference throughout the API:

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
});

// Path params are inferred from URL
api.get("/users/:id", { params: { id: 1 } }); // id is required
api.get("/users/:id", {}); // Error: params is required

// Schema output type is inferred
const user = await api.get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema);
// user is { id: number; name: string }

// Transform output type is inferred
const name = await api.get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema)
  .transform((u) => u.name);
// name is string

// Safe mode result is typed
const result = await api.get("/users/:id", { params: { id: 1 } })
  .schema(UserSchema)
  .safe();
// result is { data?: { id: number; name: string }; error?: Error }
```

## Legacy API

The previous `UniversalClient` API is still available as `createUniversalClient`:

```typescript
import { createUniversalClient } from "@cordy/endpoint-builder";

const api = createUniversalClient({
  baseUrl: "https://api.example.com",
});

// Simple methods
const users = await api.get("/users");
const user = await api.post("/users", { name: "John" });

// Access underlying HttpClient
const response = await api.httpClient.get("/users/1").data();
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
