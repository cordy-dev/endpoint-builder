# API Guide for endpoint-builder Library

Detailed description of all classes, methods, and options of the endpoint-builder library.

## Contents

- [Universal API (createClient)](#universal-api-createclient)
- [HttpClient](#httpclient)
- [RequestBuilder](#requestbuilder)
- [Authentication Strategies](#authentication-strategies)
- [Retry Strategies](#retry-strategies)
- [Data Storage](#data-storage)
- [Utilities](#utilities)
- [Data Types](#data-types)

## Universal API (createClient)

The recommended way to use the library is through the universal `createClient` function that supports both simple and advanced use cases.

### createClient

```typescript
function createClient(options?: UniversalClientOptions): UniversalClient;
```

Creates a universal HTTP client instance.

#### Parameters:

- `options`: Configuration object with the following properties:
    - `baseUrl`: Base URL for all requests
    - `auth`: Authorization header value (auto-detects Bearer token)
    - `apiKey`: API key for X-API-Key header
    - `authStrategy`: Custom authentication strategy
    - `storage`: Storage for tokens/auth data
    - `headers`: Default headers for all requests
    - `timeout`: Request timeout in milliseconds (default: 30000)
    - `retry`: Enable automatic retries (default: true)
    - `retryStrategy`: Custom retry strategy
    - `dedupe`: Enable request deduplication (default: true)
    - `responseType`: Default response type

### UniversalClient Methods

#### Simple HTTP Methods

```typescript
get<T>(path: string, options?: {
  query?: Record<string, any>;
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>

post<T>(path: string, data?: any, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>

put<T>(path: string, data?: any, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>

patch<T>(path: string, data?: any, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>

delete<T>(path: string, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>
```

#### Specialized Methods

```typescript
upload<T>(path: string, files: Record<string, File | string>, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<T>
```

Uploads files using FormData.

```typescript
download(path: string, options?: {
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<Blob>
```

Downloads a file as Blob.

```typescript
response<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options?: {
  data?: any;
  query?: Record<string, any>;
  headers?: HttpHeaders;
  timeout?: number;
}): Promise<HttpResponse<T>>
```

Returns the full response instead of just data.

#### Advanced Methods

```typescript
request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string): RequestBuilder<T, any, any>
```

Returns a RequestBuilder for advanced request configuration.

```typescript
get httpClient(): HttpClient
```

Access the underlying HttpClient for full control.

## HttpClient

The main class for executing HTTP requests. Usually accessed through `createClient().httpClient`.

### Constructor

```typescript
constructor(opts: HttpClientOptions = {})
```

#### Parameters:

- `opts`: Configuration object with the following properties:
    - `baseUrl`: Base URL for all requests
    - `auth`: Authentication strategy
    - `storage`: Data storage (defaults to LocalStoragePersist)
    - `defaultHeaders`: Default headers for all requests
    - `dedupe`: Enable deduplication of identical requests (default: false)
    - `responseType`: Default response type
    - `retryStrategy`: Retry strategy (defaults to ExponentialRetryStrategy)

### Methods

#### HTTP Methods

These methods create a `RequestBuilder` object for the corresponding HTTP method:

```typescript
get<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string): RequestBuilder<T, undefined, Q>

post<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string): RequestBuilder<T, B, Q>

put<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string): RequestBuilder<T, B, Q>

patch<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string): RequestBuilder<T, B, Q>

delete<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string): RequestBuilder<T, undefined, Q>
```

Parameters:

- `path`: Path or full URL for the request
- Generic parameters:
    - `T`: Type of expected response
    - `B`: Type of request body
    - `Q`: Type of query parameters

#### Internal Methods

These methods are used internally within the library:

```typescript
_execute<T, B, Q>(rb: RequestBuilder<T, B, Q>): Promise<HttpResponse<T>>
```

Executes an HTTP request based on the configuration from RequestBuilder.

```typescript
_clone(patch: Partial<HttpClientOptions>): HttpClient
```

Creates a new HttpClient instance with modified options.

```typescript
_wrap<T, B, Q>(builder: RequestBuilder<T, B, Q>): RequestBuilder<T, B, Q>
```

Wraps RequestBuilder in a new instance.

## RequestBuilder

Class for building HTTP requests with method chaining. Usually created by `HttpClient` methods.

### Constructor

```typescript
constructor(client: HttpClient, input: string)
```

#### Parameters:

- `client`: HttpClient instance
- `input`: Request path or URL

### Methods

#### Request Configuration

```typescript
method<M extends HttpMethod>(method: M): this
```

Sets the HTTP method for the request.

```typescript
query<Q extends Record<string, unknown>>(params: Q): RequestBuilder<TResp, TBody, Q>
```

Sets query parameters.

```typescript
headers(headerMap: HttpHeaders): this
```

Sets multiple headers.

```typescript
header(name: string, value: string): this
```

Sets a single header.

```typescript
responseType<R extends ResponseType>(responseType: R): this
```

Sets the expected response type.

#### Methods for Working with Request Body

```typescript
body<B extends BodyLike>(data: B): RequestBuilder<TResp, B, TQuery>
```

Sets the request body.

```typescript
json<B extends object & BodyLike>(data: B): RequestBuilder<TResp, B, TQuery>
```

Sets JSON body and corresponding Content-Type.

```typescript
form(data: FormData | Record<string, any>, urlencoded = true): this
```

Sets form data. If `urlencoded` is true, sets Content-Type to `application/x-www-form-urlencoded`, otherwise `multipart/form-data`.

#### Authentication and Execution Control

```typescript
auth(strategy: AuthStrategy | null): this
```

Sets the authentication strategy for this request. Pass null to disable authentication.

```typescript
dedupe(enable = true): this
```

Enables/disables request deduplication. When enabled, identical concurrent requests will return the same promise.

```typescript
timeout(ms: number): this
```

Sets request timeout in milliseconds.

```typescript
signal(signal: AbortSignal): this
```

Sets a signal for request cancellation.

```typescript
retry(strategy: RetryStrategy | null): this
```

Sets the retry strategy for this request.

#### Request Execution

```typescript
async data(): Promise<TResp>
```

Executes the request and returns only the response data. If the response is a JSON string, it will be parsed automatically.

```typescript
send(): Promise<HttpResponse<TResp>>
```

Executes the request and returns the full response object.

## Authentication Strategies

### AuthStrategy (interface)

```typescript
interface AuthStrategy {
	enrichRequest(req: Request): Promise<Partial<HttpHeaders>>;
	handleRequestError?(req: Request, res: Response): Promise<boolean>;
}
```

### ApiKeyStrategy

Strategy for authentication using an API key.

```typescript
constructor(
  headerName: string = "X-API-Key",
  key: string,
  asQueryParam = false
)
```

#### Parameters:

- `headerName`: Header name for the API key (default "X-API-Key"), or query parameter name if `asQueryParam` is true
- `key`: The API key value
- `asQueryParam`: Send key as a query parameter instead of header (default false)

### OpaqueTokenStrategy

Strategy for token-based authentication with automatic refresh.

```typescript
constructor(
  storage: PersistStorage,
  refreshEndpoint: string,
  headerName = "Authorization"
)
```

#### Parameters:

- `storage`: Storage implementation for persisting tokens
- `refreshEndpoint`: URL endpoint for refreshing tokens
- `headerName`: Header name for the token (default "Authorization")

The strategy expects tokens to be stored in the format:

```typescript
{ access: string; refresh?: string; }
```

The refresh endpoint should accept a POST request with body:

```json
{ "token": "refresh_token_value" }
```

And return:

```json
{ "access": "new_access_token", "refresh": "new_refresh_token" }
```

## Retry Strategies

### RetryStrategy (interface)

```typescript
interface RetryStrategy {
	shouldRetry(ctx: RetryContext): boolean | Promise<boolean>;
	nextDelay(ctx: RetryContext): number | Promise<number>;
}
```

### ExponentialRetryStrategy

Retry strategy with exponential backoff and jitter.

```typescript
constructor((maxAttempts = 3), (base = 300), (maxDelay = 10_000));
```

#### Parameters:

- `maxAttempts`: Maximum number of retry attempts (default 3)
- `base`: Base delay in milliseconds (default 300)
- `maxDelay`: Maximum delay in milliseconds (default 10,000)

The strategy retries on:

- Network errors (no response)
- 5xx server errors
- 429 Too Many Requests

## Data Storage

### PersistStorage (interface)

```typescript
interface PersistStorage {
	get<T = unknown>(key: string): Promise<T | undefined>;
	set<T = unknown>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
}
```

### LocalStoragePersist

Implementation of PersistStorage using browser's localStorage.

```typescript
constructor();
```

Stores values as JSON strings in localStorage.

### MemoryStoragePersist

Implementation of PersistStorage with in-memory data storage.

```typescript
constructor();
```

Stores values in memory using a Map. Data is lost when the application restarts.

## Utilities

### mergeHeaders

```typescript
function mergeHeaders(target: HttpHeaders = {}, src?: HttpHeaders): HttpHeaders;
```

Merges two header objects, with headers from `src` taking precedence.

### toQuery

```typescript
function toQuery<Q extends Record<string, unknown>>(
	params: Q | undefined,
): string;
```

Converts an object to a URL query string. Spaces are encoded as `%20`.

### serializeBody

```typescript
function serializeBody<B>(
	body: B,
	headers: HttpHeaders,
): B | string | undefined;
```

Serializes the request body based on content type. Returns:

- `undefined` for null/undefined bodies
- The body as-is for FormData, Blob, ArrayBuffer, ReadableStream
- JSON string for objects when Content-Type includes "application/json"
- The body as-is for other cases

### decodeResponse

```typescript
async function decodeResponse<T>(
	response: Response,
	config: HttpRequestConfig,
): Promise<T>;
```

Decodes the response based on:

1. Explicit `responseType` in config if provided
2. Content-Type header:
    - `application/json` → JSON parse
    - `text/*` → text
    - Default → blob

## Data Types

### UniversalClientOptions

```typescript
interface UniversalClientOptions {
	baseUrl?: string;
	auth?: string;
	apiKey?: string;
	authStrategy?: AuthStrategy;
	storage?: PersistStorage;
	headers?: HttpHeaders;
	timeout?: number;
	retry?: boolean;
	retryStrategy?: RetryStrategy | null;
	dedupe?: boolean;
	responseType?: "json" | "text" | "blob" | "arraybuffer" | "stream";
}
```

### HttpClientOptions

```typescript
interface HttpClientOptions {
	baseUrl?: string;
	auth?: AuthStrategy | null;
	storage?: PersistStorage;
	defaultHeaders?: HttpHeaders;
	dedupe?: boolean;
	responseType?: ResponseType;
	retryStrategy?: RetryStrategy | null;
}
```

### HttpHeaders

```typescript
interface HttpHeaders {
	[key: string]: string | string[] | undefined;
}
```

### HttpMethod

```typescript
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
```

### ResponseType

```typescript
type ResponseType = "json" | "text" | "blob" | "stream" | "arraybuffer";
```

### HttpRequestConfig

```typescript
interface HttpRequestConfig {
	url: string;
	method: HttpMethod;
	headers?: HttpHeaders;
	body?: any;
	timeout?: number;
	signal?: AbortSignal;
	responseType?: ResponseType;
}
```

### HttpResponse

```typescript
interface HttpResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	headers: HttpHeaders;
	config: HttpRequestConfig;
}
```

### HttpError

```typescript
interface HttpError extends Error {
	config: HttpRequestConfig;
	response?: HttpResponse;
	status?: number;
	statusText?: string;
	code?: string;
}
```

### RetryContext

```typescript
interface RetryContext {
	attempt: number; // starts at 1
	error?: HttpError;
	response?: Response;
	config: HttpRequestConfig;
}
```

### BodyLike

```typescript
type BodyLike = BodyInit | Record<string, unknown> | null | object | undefined;
```
