# Library Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Переписать библиотеку как типобезопасный HTTP-клиент с runtime валидацией через Standard Schema.

**Architecture:** Минималистичный API с цепочками методов. Path параметры извлекаются через TypeScript template literal types. Валидация через Standard Schema (поддержка zod/valibot/arktype). Result type через `.safe()`.

**Tech Stack:** TypeScript 5.x, Vitest, Standard Schema interface

---

## Task 1: Path Parameter Type Extraction

**Files:**
- Create: `src/types/path-params.ts`
- Test: `tests/path-params.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/path-params.test.ts
import { describe, it, expectTypeOf } from 'vitest'
import type { ExtractPathParams } from '../src/types/path-params'

describe('ExtractPathParams', () => {
  it('should extract single param', () => {
    type Params = ExtractPathParams<'/users/:id'>
    expectTypeOf<Params>().toEqualTypeOf<{ id: string | number }>()
  })

  it('should extract multiple params', () => {
    type Params = ExtractPathParams<'/users/:userId/posts/:postId'>
    expectTypeOf<Params>().toEqualTypeOf<{ userId: string | number; postId: string | number }>()
  })

  it('should return empty object for no params', () => {
    type Params = ExtractPathParams<'/users'>
    expectTypeOf<Params>().toEqualTypeOf<{}>()
  })

  it('should handle params at the end', () => {
    type Params = ExtractPathParams<'/api/v1/items/:itemId'>
    expectTypeOf<Params>().toEqualTypeOf<{ itemId: string | number }>()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/path-params.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/types/path-params.ts

/**
 * Extract path parameter names from a URL pattern
 * e.g., '/users/:id/posts/:postId' -> 'id' | 'postId'
 */
export type ExtractParamNames<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParamNames<`/${Rest}`>
    : T extends `${string}:${infer Param}`
      ? Param
      : never

/**
 * Convert parameter names to object type
 * e.g., 'id' | 'postId' -> { id: string | number; postId: string | number }
 */
export type ExtractPathParams<T extends string> =
  ExtractParamNames<T> extends never
    ? {}
    : { [K in ExtractParamNames<T>]: string | number }

/**
 * Check if path has parameters
 */
export type HasPathParams<T extends string> = T extends `${string}:${string}` ? true : false

/**
 * Replace path parameters with values
 */
export function buildPath<T extends string>(
  template: T,
  params: ExtractPathParams<T>
): string {
  let result: string = template
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`:${key}`, String(value))
  }
  return result
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/path-params.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/path-params.ts tests/path-params.test.ts
git commit -m "feat: add path parameter type extraction"
```

---

## Task 2: Standard Schema Types

**Files:**
- Create: `src/types/schema.ts`
- Test: `tests/schema-types.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/schema-types.test.ts
import { describe, it, expect, expectTypeOf } from 'vitest'
import type { InferOutput, StandardSchema } from '../src/types/schema'
import { validateWithSchema } from '../src/types/schema'

// Mock schema that follows Standard Schema interface
const mockUserSchema = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'id' in value && 'name' in value) {
        return { value: value as { id: number; name: string } }
      }
      return { issues: [{ message: 'Invalid user' }] }
    }
  }
} satisfies StandardSchema<{ id: number; name: string }>

describe('Schema Types', () => {
  it('should infer output type from schema', () => {
    type Output = InferOutput<typeof mockUserSchema>
    expectTypeOf<Output>().toEqualTypeOf<{ id: number; name: string }>()
  })

  it('should validate valid data', async () => {
    const result = await validateWithSchema(mockUserSchema, { id: 1, name: 'John' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ id: 1, name: 'John' })
    }
  })

  it('should reject invalid data', async () => {
    const result = await validateWithSchema(mockUserSchema, { invalid: true })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues).toHaveLength(1)
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/schema-types.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/types/schema.ts

/**
 * Standard Schema interface (v1)
 * Compatible with zod, valibot, arktype, etc.
 */
export interface StandardSchema<T = unknown> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => StandardSchemaResult<T>
  }
}

export interface StandardSchemaResult<T> {
  readonly value?: T
  readonly issues?: readonly StandardSchemaIssue[]
}

export interface StandardSchemaIssue {
  readonly message: string
  readonly path?: readonly (string | number)[]
}

/**
 * Infer output type from a Standard Schema
 */
export type InferOutput<S> = S extends StandardSchema<infer T> ? T : never

/**
 * Validation result type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: readonly StandardSchemaIssue[] }

/**
 * Validate data against a Standard Schema
 */
export async function validateWithSchema<T>(
  schema: StandardSchema<T>,
  data: unknown
): Promise<ValidationResult<T>> {
  const result = schema['~standard'].validate(data)

  // Handle async validation
  const resolved = result instanceof Promise ? await result : result

  if (resolved.issues && resolved.issues.length > 0) {
    return { success: false, issues: resolved.issues }
  }

  return { success: true, data: resolved.value as T }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/schema-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/schema.ts tests/schema-types.test.ts
git commit -m "feat: add Standard Schema types and validation"
```

---

## Task 3: Error Classes

**Files:**
- Create: `src/errors/index.ts`
- Create: `src/errors/HttpError.ts`
- Create: `src/errors/ValidationError.ts`
- Create: `src/errors/NetworkError.ts`
- Test: `tests/errors.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/errors.test.ts
import { describe, it, expect } from 'vitest'
import { HttpError, ValidationError, NetworkError } from '../src/errors'

describe('Error Classes', () => {
  describe('HttpError', () => {
    it('should create with status and response', () => {
      const error = new HttpError(404, 'Not Found', { message: 'User not found' })

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(HttpError)
      expect(error.status).toBe(404)
      expect(error.statusText).toBe('Not Found')
      expect(error.response).toEqual({ message: 'User not found' })
      expect(error.message).toBe('HTTP 404: Not Found')
      expect(error.name).toBe('HttpError')
    })

    it('should have type property', () => {
      const error = new HttpError(500, 'Internal Server Error')
      expect(error.type).toBe('http')
    })
  })

  describe('ValidationError', () => {
    it('should create with issues and received data', () => {
      const issues = [{ message: 'Expected string, got number', path: ['name'] }]
      const received = { name: 123 }
      const error = new ValidationError(issues, received)

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(ValidationError)
      expect(error.issues).toEqual(issues)
      expect(error.received).toEqual(received)
      expect(error.message).toBe('Validation failed: Expected string, got number')
      expect(error.name).toBe('ValidationError')
      expect(error.type).toBe('validation')
    })
  })

  describe('NetworkError', () => {
    it('should create with cause', () => {
      const cause = new TypeError('Failed to fetch')
      const error = new NetworkError('Network request failed', cause)

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(NetworkError)
      expect(error.cause).toBe(cause)
      expect(error.message).toBe('Network request failed')
      expect(error.name).toBe('NetworkError')
      expect(error.type).toBe('network')
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/errors.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/errors/HttpError.ts
import type { HttpRequestConfig } from '../types'

export class HttpError extends Error {
  readonly type = 'http' as const
  readonly name = 'HttpError'

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly response?: unknown,
    public readonly request?: HttpRequestConfig
  ) {
    super(`HTTP ${status}: ${statusText}`)
  }
}
```

```typescript
// src/errors/ValidationError.ts
import type { StandardSchemaIssue } from '../types/schema'

export class ValidationError extends Error {
  readonly type = 'validation' as const
  readonly name = 'ValidationError'

  constructor(
    public readonly issues: readonly StandardSchemaIssue[],
    public readonly received: unknown
  ) {
    const firstIssue = issues[0]?.message ?? 'Unknown validation error'
    super(`Validation failed: ${firstIssue}`)
  }
}
```

```typescript
// src/errors/NetworkError.ts
export class NetworkError extends Error {
  readonly type = 'network' as const
  readonly name = 'NetworkError'

  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message)
  }
}
```

```typescript
// src/errors/index.ts
export { HttpError } from './HttpError'
export { ValidationError } from './ValidationError'
export { NetworkError } from './NetworkError'

export type ApiError = HttpError | ValidationError | NetworkError
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/errors.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/errors tests/errors.test.ts
git commit -m "feat: add typed error classes"
```

---

## Task 4: Result Type and Safe Wrapper

**Files:**
- Create: `src/types/result.ts`
- Test: `tests/result.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/result.test.ts
import { describe, it, expect, expectTypeOf } from 'vitest'
import { ok, err, type Result } from '../src/types/result'
import { HttpError, ValidationError, NetworkError } from '../src/errors'

describe('Result Type', () => {
  it('should create success result', () => {
    const result = ok({ id: 1, name: 'John' })

    expect(result.data).toEqual({ id: 1, name: 'John' })
    expect(result.error).toBeUndefined()
  })

  it('should create error result', () => {
    const error = new HttpError(404, 'Not Found')
    const result = err(error)

    expect(result.data).toBeUndefined()
    expect(result.error).toBe(error)
  })

  it('should narrow types correctly', () => {
    const result: Result<{ id: number }, HttpError> = ok({ id: 1 })

    if (result.error) {
      expectTypeOf(result.error).toEqualTypeOf<HttpError>()
      expectTypeOf(result.data).toEqualTypeOf<undefined>()
    } else {
      expectTypeOf(result.data).toEqualTypeOf<{ id: number }>()
      expectTypeOf(result.error).toEqualTypeOf<undefined>()
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/result.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/types/result.ts
import type { ApiError } from '../errors'

/**
 * Result type for safe operations
 * Inspired by Rust's Result type
 */
export type Result<T, E = ApiError> =
  | { data: T; error: undefined }
  | { data: undefined; error: E }

/**
 * Create a success result
 */
export function ok<T>(data: T): Result<T, never> {
  return { data, error: undefined }
}

/**
 * Create an error result
 */
export function err<E>(error: E): Result<never, E> {
  return { data: undefined, error }
}

/**
 * Type guard for success result
 */
export function isOk<T, E>(result: Result<T, E>): result is { data: T; error: undefined } {
  return result.error === undefined
}

/**
 * Type guard for error result
 */
export function isErr<T, E>(result: Result<T, E>): result is { data: undefined; error: E } {
  return result.error !== undefined
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/result.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types/result.ts tests/result.test.ts
git commit -m "feat: add Result type for safe operations"
```

---

## Task 5: Updated Request Builder with Schema Validation

**Files:**
- Modify: `src/core/RequestBuilder.ts`
- Test: `tests/RequestBuilder.schema.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/RequestBuilder.schema.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpClient } from '../src/core/HttpClient'
import type { StandardSchema } from '../src/types/schema'
import { ValidationError } from '../src/errors'
import { mockFetch } from './utils/test-helpers'

// Mock schema
const UserSchema: StandardSchema<{ id: number; name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof (value as any).id === 'number' &&
        'name' in value &&
        typeof (value as any).name === 'string'
      ) {
        return { value: value as { id: number; name: string } }
      }
      return { issues: [{ message: 'Invalid user object' }] }
    }
  }
}

describe('RequestBuilder Schema Validation', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('should validate response with schema', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const client = new HttpClient({ baseUrl: 'https://api.test.com' })
    const user = await client.get('/users/1').schema(UserSchema)

    expect(user).toEqual({ id: 1, name: 'John' })
  })

  it('should throw ValidationError for invalid response', async () => {
    global.fetch = mockFetch({ invalid: 'data' })

    const client = new HttpClient({ baseUrl: 'https://api.test.com' })

    await expect(
      client.get('/users/1').schema(UserSchema)
    ).rejects.toThrow(ValidationError)
  })

  it('should return Result with safe()', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const client = new HttpClient({ baseUrl: 'https://api.test.com' })
    const result = await client.get('/users/1').schema(UserSchema).safe()

    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ id: 1, name: 'John' })
  })

  it('should return error in Result for invalid response', async () => {
    global.fetch = mockFetch({ invalid: 'data' })

    const client = new HttpClient({ baseUrl: 'https://api.test.com' })
    const result = await client.get('/users/1').schema(UserSchema).safe()

    expect(result.data).toBeUndefined()
    expect(result.error).toBeInstanceOf(ValidationError)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/RequestBuilder.schema.test.ts`
Expected: FAIL - schema method not found

**Step 3: Update RequestBuilder implementation**

Add to `src/core/RequestBuilder.ts`:

```typescript
import type { StandardSchema, InferOutput } from '../types/schema'
import { validateWithSchema } from '../types/schema'
import { ValidationError } from '../errors'
import { ok, err, type Result } from '../types/result'
import type { ApiError } from '../errors'

// Add to RequestBuilder class:

  private _schema?: StandardSchema<any>
  private _bodySchema?: StandardSchema<any>
  private _transform?: (data: any) => any

  /**
   * Set response schema for validation
   */
  schema<S extends StandardSchema<any>>(schema: S): SchemaRequestBuilder<InferOutput<S>, TBody, TQuery> {
    const builder = new SchemaRequestBuilder<InferOutput<S>, TBody, TQuery>(
      this.client,
      this.input,
      schema
    )
    // Copy all properties
    builder._method = this._method
    builder._body = this._body as any
    builder._headers = { ...this._headers }
    builder._dedupe = this._dedupe
    builder._query = this._query as any
    builder._responseType = this._responseType
    builder._timeout = this._timeout
    builder._signal = this._signal
    builder._retry = this._retry
    builder._auth = this._auth
    return builder
  }

// New class for schema-validated requests:

export class SchemaRequestBuilder<
  TResp,
  TBody extends BodyLike = BodyLike,
  TQuery extends Record<string, unknown> | undefined = undefined
> extends RequestBuilder<TResp, TBody, TQuery> {
  constructor(
    client: HttpClient,
    input: string,
    private readonly _schema: StandardSchema<TResp>
  ) {
    super(client, input)
  }

  /**
   * Execute and validate, returning data directly (throws on error)
   */
  override async data(): Promise<TResp> {
    const response = await this.client._execute(this as any)
    const result = await validateWithSchema(this._schema, response.data)

    if (!result.success) {
      throw new ValidationError(result.issues, response.data)
    }

    return result.data
  }

  /**
   * Execute and validate, returning Result (never throws)
   */
  async safe(): Promise<Result<TResp, ApiError>> {
    try {
      const data = await this.data()
      return ok(data)
    } catch (error) {
      return err(error as ApiError)
    }
  }

  /**
   * Transform data after validation
   */
  transform<U>(fn: (data: TResp) => U): TransformRequestBuilder<U, TBody, TQuery> {
    return new TransformRequestBuilder(this, fn)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/RequestBuilder.schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/RequestBuilder.ts tests/RequestBuilder.schema.test.ts
git commit -m "feat: add schema validation to RequestBuilder"
```

---

## Task 6: Response Unwrapping

**Files:**
- Modify: `src/core/HttpClient.ts`
- Test: `tests/unwrap.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/unwrap.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { HttpClient } from '../src/core/HttpClient'
import { mockFetch } from './utils/test-helpers'

describe('Response Unwrapping', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('should unwrap response globally', async () => {
    global.fetch = mockFetch({
      data: { id: 1, name: 'John' },
      meta: { timestamp: '2024-01-01' }
    })

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
      unwrap: (response) => response.data
    })

    const user = await client.get('/users/1').data()
    expect(user).toEqual({ id: 1, name: 'John' })
  })

  it('should disable unwrap for specific request', async () => {
    global.fetch = mockFetch({
      data: { id: 1, name: 'John' },
      meta: { timestamp: '2024-01-01' }
    })

    const client = new HttpClient({
      baseUrl: 'https://api.test.com',
      unwrap: (response) => response.data
    })

    const full = await client.get('/users/1').unwrap(false).data()
    expect(full).toEqual({
      data: { id: 1, name: 'John' },
      meta: { timestamp: '2024-01-01' }
    })
  })

  it('should use custom unwrap per request', async () => {
    global.fetch = mockFetch({ items: [1, 2, 3], total: 100 })

    const client = new HttpClient({ baseUrl: 'https://api.test.com' })

    const items = await client
      .get('/items')
      .unwrap((r: any) => r.items)
      .data()

    expect(items).toEqual([1, 2, 3])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unwrap.test.ts`
Expected: FAIL - unwrap option/method not found

**Step 3: Update HttpClient and RequestBuilder**

Add to `HttpClientOptions`:
```typescript
unwrap?: <T>(response: T) => unknown
```

Add to `RequestBuilder`:
```typescript
private _unwrap?: ((response: any) => any) | false

unwrap(fn: ((response: any) => any) | false): this {
  this._unwrap = fn
  return this
}
```

Update `_execute` to apply unwrap.

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unwrap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/HttpClient.ts src/core/RequestBuilder.ts tests/unwrap.test.ts
git commit -m "feat: add response unwrapping"
```

---

## Task 7: Updated createClient API

**Files:**
- Rewrite: `src/simple.ts` → `src/client.ts`
- Test: `tests/createClient.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/createClient.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClient } from '../src/client'
import type { StandardSchema } from '../src/types/schema'
import { mockFetch } from './utils/test-helpers'

const UserSchema: StandardSchema<{ id: number; name: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => {
      if (typeof value === 'object' && value !== null && 'id' in value && 'name' in value) {
        return { value: value as { id: number; name: string } }
      }
      return { issues: [{ message: 'Invalid user' }] }
    }
  }
}

describe('createClient', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  it('should create client with minimal config', () => {
    const api = createClient({ baseUrl: 'https://api.test.com' })
    expect(api).toBeDefined()
    expect(api.get).toBeInstanceOf(Function)
    expect(api.post).toBeInstanceOf(Function)
  })

  it('should make GET request with path params', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const api = createClient({ baseUrl: 'https://api.test.com' })
    const user = await api
      .get('/users/:id', { params: { id: 1 } })
      .schema(UserSchema)

    expect(user).toEqual({ id: 1, name: 'John' })
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test.com/users/1',
      expect.anything()
    )
  })

  it('should make POST request with body', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const api = createClient({ baseUrl: 'https://api.test.com' })
    const user = await api
      .post('/users', { body: { name: 'John' } })
      .schema(UserSchema)

    expect(user).toEqual({ id: 1, name: 'John' })
  })

  it('should support safe mode', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const api = createClient({ baseUrl: 'https://api.test.com' })
    const result = await api
      .get('/users/:id', { params: { id: 1 } })
      .schema(UserSchema)
      .safe()

    expect(result.data).toEqual({ id: 1, name: 'John' })
    expect(result.error).toBeUndefined()
  })

  it('should override options per request', async () => {
    global.fetch = mockFetch({ id: 1, name: 'John' })

    const api = createClient({
      baseUrl: 'https://api.test.com',
      timeout: 5000
    })

    await api
      .get('/users/:id', { params: { id: 1 }, timeout: 10000 })
      .schema(UserSchema)

    // Verify timeout was applied (would need to check internally)
    expect(global.fetch).toHaveBeenCalled()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/createClient.test.ts`
Expected: FAIL

**Step 3: Implement new createClient**

```typescript
// src/client.ts
import { HttpClient, type HttpClientOptions } from './core/HttpClient'
import { RequestBuilder } from './core/RequestBuilder'
import type { ExtractPathParams, HasPathParams } from './types/path-params'
import { buildPath } from './types/path-params'
import type { HttpHeaders, HttpMethod, QueryParams } from './types'
import type { AuthStrategy } from './auth'
import type { RetryStrategy } from './retry'

export interface ClientOptions {
  baseUrl?: string
  auth?: string | AuthConfig | AuthStrategy
  timeout?: number
  retry?: boolean | number | RetryConfig | RetryStrategy
  headers?: HttpHeaders
  unwrap?: <T>(response: T) => unknown
}

export interface AuthConfig {
  type: 'bearer' | 'apiKey' | 'basic'
  token?: string
  key?: string
  header?: string
  username?: string
  password?: string
}

export interface RetryConfig {
  attempts?: number
  delay?: number
  maxDelay?: number
  backoff?: 'exponential' | 'linear' | 'constant'
  jitter?: boolean
  retryOn?: number[]
}

export interface RequestOptions<
  TPath extends string,
  TBody = unknown
> {
  params?: HasPathParams<TPath> extends true ? ExtractPathParams<TPath> : never
  query?: QueryParams
  body?: TBody
  headers?: HttpHeaders
  timeout?: number
  auth?: string | AuthConfig | AuthStrategy | false
  retry?: boolean | number | RetryConfig | RetryStrategy | false
}

export class Client {
  private readonly httpClient: HttpClient

  constructor(options: ClientOptions = {}) {
    this.httpClient = new HttpClient(this.normalizeOptions(options))
  }

  private normalizeOptions(options: ClientOptions): HttpClientOptions {
    // Convert simple options to HttpClientOptions
    return {
      baseUrl: options.baseUrl,
      defaultHeaders: options.headers,
      unwrap: options.unwrap,
      // TODO: normalize auth and retry
    }
  }

  get<TPath extends string>(
    path: TPath,
    options?: RequestOptions<TPath>
  ): RequestBuilder<unknown> {
    const resolvedPath = options?.params
      ? buildPath(path, options.params as any)
      : path

    const builder = this.httpClient.get(resolvedPath)

    if (options?.query) builder.query(options.query)
    if (options?.headers) builder.headers(options.headers)
    if (options?.timeout) builder.timeout(options.timeout)

    return builder
  }

  post<TPath extends string, TBody = unknown>(
    path: TPath,
    options?: RequestOptions<TPath, TBody>
  ): RequestBuilder<unknown> {
    const resolvedPath = options?.params
      ? buildPath(path, options.params as any)
      : path

    const builder = this.httpClient.post(resolvedPath)

    if (options?.body) builder.json(options.body as object)
    if (options?.query) builder.query(options.query)
    if (options?.headers) builder.headers(options.headers)
    if (options?.timeout) builder.timeout(options.timeout)

    return builder
  }

  put<TPath extends string, TBody = unknown>(
    path: TPath,
    options?: RequestOptions<TPath, TBody>
  ): RequestBuilder<unknown> {
    const resolvedPath = options?.params
      ? buildPath(path, options.params as any)
      : path

    const builder = this.httpClient.put(resolvedPath)

    if (options?.body) builder.json(options.body as object)
    if (options?.query) builder.query(options.query)
    if (options?.headers) builder.headers(options.headers)
    if (options?.timeout) builder.timeout(options.timeout)

    return builder
  }

  patch<TPath extends string, TBody = unknown>(
    path: TPath,
    options?: RequestOptions<TPath, TBody>
  ): RequestBuilder<unknown> {
    const resolvedPath = options?.params
      ? buildPath(path, options.params as any)
      : path

    const builder = this.httpClient.patch(resolvedPath)

    if (options?.body) builder.json(options.body as object)
    if (options?.query) builder.query(options.query)
    if (options?.headers) builder.headers(options.headers)
    if (options?.timeout) builder.timeout(options.timeout)

    return builder
  }

  delete<TPath extends string>(
    path: TPath,
    options?: RequestOptions<TPath>
  ): RequestBuilder<unknown> {
    const resolvedPath = options?.params
      ? buildPath(path, options.params as any)
      : path

    const builder = this.httpClient.delete(resolvedPath)

    if (options?.query) builder.query(options.query)
    if (options?.headers) builder.headers(options.headers)
    if (options?.timeout) builder.timeout(options.timeout)

    return builder
  }
}

export function createClient(options?: ClientOptions): Client {
  return new Client(options)
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/createClient.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/client.ts tests/createClient.test.ts
git commit -m "feat: implement new createClient API"
```

---

## Task 8: Auth Strategy Helpers

**Files:**
- Create: `src/auth/helpers.ts`
- Test: `tests/auth-helpers.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/auth-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { bearerAuth, apiKeyAuth, basicAuth } from '../src/auth/helpers'

describe('Auth Helpers', () => {
  describe('bearerAuth', () => {
    it('should create bearer auth with static token', async () => {
      const auth = bearerAuth('my-token')
      const headers = await auth.prepare({ url: 'https://api.test.com' } as any)

      expect(headers).toEqual({
        headers: { Authorization: 'Bearer my-token' }
      })
    })

    it('should create bearer auth with dynamic token', async () => {
      let token = 'initial'
      const auth = bearerAuth(() => token)

      const headers1 = await auth.prepare({ url: 'https://api.test.com' } as any)
      expect(headers1).toEqual({ headers: { Authorization: 'Bearer initial' } })

      token = 'updated'
      const headers2 = await auth.prepare({ url: 'https://api.test.com' } as any)
      expect(headers2).toEqual({ headers: { Authorization: 'Bearer updated' } })
    })
  })

  describe('apiKeyAuth', () => {
    it('should create API key auth with custom header', async () => {
      const auth = apiKeyAuth('my-key', 'X-API-Key')
      const headers = await auth.prepare({ url: 'https://api.test.com' } as any)

      expect(headers).toEqual({
        headers: { 'X-API-Key': 'my-key' }
      })
    })

    it('should use default header name', async () => {
      const auth = apiKeyAuth('my-key')
      const headers = await auth.prepare({ url: 'https://api.test.com' } as any)

      expect(headers).toEqual({
        headers: { 'X-API-Key': 'my-key' }
      })
    })
  })

  describe('basicAuth', () => {
    it('should create basic auth', async () => {
      const auth = basicAuth('user', 'pass')
      const headers = await auth.prepare({ url: 'https://api.test.com' } as any)

      // Base64 of 'user:pass'
      const expected = 'Basic ' + btoa('user:pass')
      expect(headers).toEqual({
        headers: { Authorization: expected }
      })
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-helpers.test.ts`
Expected: FAIL - module not found

**Step 3: Write implementation**

```typescript
// src/auth/helpers.ts
import type { AuthStrategy } from './AuthStrategy'
import type { HttpRequestConfig, HttpHeaders } from '../types'

export interface AuthResult {
  headers?: HttpHeaders
  query?: Record<string, string>
}

/**
 * Create a Bearer token authentication strategy
 */
export function bearerAuth(
  token: string | (() => string | Promise<string>)
): AuthStrategy {
  return {
    async prepare(_request: HttpRequestConfig): Promise<AuthResult> {
      const resolvedToken = typeof token === 'function' ? await token() : token
      return {
        headers: { Authorization: `Bearer ${resolvedToken}` }
      }
    }
  }
}

/**
 * Create an API Key authentication strategy
 */
export function apiKeyAuth(
  key: string | (() => string | Promise<string>),
  headerName: string = 'X-API-Key'
): AuthStrategy {
  return {
    async prepare(_request: HttpRequestConfig): Promise<AuthResult> {
      const resolvedKey = typeof key === 'function' ? await key() : key
      return {
        headers: { [headerName]: resolvedKey }
      }
    }
  }
}

/**
 * Create a Basic authentication strategy
 */
export function basicAuth(
  username: string,
  password: string
): AuthStrategy {
  return {
    async prepare(_request: HttpRequestConfig): Promise<AuthResult> {
      const credentials = btoa(`${username}:${password}`)
      return {
        headers: { Authorization: `Basic ${credentials}` }
      }
    }
  }
}

/**
 * Create a refresh token authentication strategy
 */
export function refreshAuth(options: {
  getToken: () => string | Promise<string>
  getRefreshToken: () => string | Promise<string>
  refresh: (refreshToken: string) => Promise<string>
  shouldRefresh?: (response: Response) => boolean
}): AuthStrategy {
  const { getToken, getRefreshToken, refresh, shouldRefresh = (r) => r.status === 401 } = options

  return {
    async prepare(_request: HttpRequestConfig): Promise<AuthResult> {
      const token = await getToken()
      return {
        headers: { Authorization: `Bearer ${token}` }
      }
    },

    async onError(response: Response, retry: () => Promise<any>): Promise<any> {
      if (shouldRefresh(response)) {
        const refreshToken = await getRefreshToken()
        await refresh(refreshToken)
        return retry()
      }
      return null
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth-helpers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/auth/helpers.ts tests/auth-helpers.test.ts
git commit -m "feat: add auth helper functions"
```

---

## Task 9: Update Exports and Index

**Files:**
- Update: `src/index.ts`
- Update: `src/auth/index.ts`
- Create: `src/types/index.ts`

**Step 1: Update exports**

```typescript
// src/index.ts
export { createClient, Client } from './client'
export type { ClientOptions, RequestOptions } from './client'

export { HttpClient } from './core/HttpClient'
export { RequestBuilder, SchemaRequestBuilder } from './core/RequestBuilder'

export { HttpError, ValidationError, NetworkError } from './errors'
export type { ApiError } from './errors'

export type {
  StandardSchema,
  InferOutput,
  ValidationResult
} from './types/schema'

export type {
  ExtractPathParams,
  ExtractParamNames,
  HasPathParams
} from './types/path-params'
export { buildPath } from './types/path-params'

export type { Result } from './types/result'
export { ok, err, isOk, isErr } from './types/result'

export type {
  HttpMethod,
  HttpHeaders,
  HttpResponse,
  HttpRequestConfig,
  QueryParams,
  ResponseType,
  BodyLike
} from './types'
```

```typescript
// src/auth/index.ts
export { ApiKeyStrategy } from './ApiKeyStrategy'
export { OpaqueTokenStrategy } from './OpaqueTokenStrategy'
export type { AuthStrategy } from './AuthStrategy'

export { bearerAuth, apiKeyAuth, basicAuth, refreshAuth } from './helpers'
```

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/index.ts src/auth/index.ts src/types/index.ts
git commit -m "chore: update exports"
```

---

## Task 10: Integration Tests

**Files:**
- Create: `tests/integration-new.test.ts`

**Step 1: Write integration tests**

```typescript
// tests/integration-new.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createClient, ValidationError, HttpError } from '../src'
import type { StandardSchema } from '../src/types/schema'
import { mockFetch } from './utils/test-helpers'

// Schemas
const UserSchema: StandardSchema<{ id: number; name: string; email: string }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        'name' in value &&
        'email' in value
      ) {
        return { value: value as { id: number; name: string; email: string } }
      }
      return { issues: [{ message: 'Invalid user' }] }
    }
  }
}

describe('Integration Tests', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.resetAllMocks()
  })

  describe('Full workflow', () => {
    it('should perform CRUD operations with validation', async () => {
      const api = createClient({ baseUrl: 'https://api.test.com' })

      // GET with path params
      global.fetch = mockFetch({ id: 1, name: 'John', email: 'john@test.com' })
      const user = await api
        .get('/users/:id', { params: { id: 1 } })
        .schema(UserSchema)
      expect(user).toEqual({ id: 1, name: 'John', email: 'john@test.com' })

      // POST with body
      global.fetch = mockFetch({ id: 2, name: 'Jane', email: 'jane@test.com' })
      const created = await api
        .post('/users', { body: { name: 'Jane', email: 'jane@test.com' } })
        .schema(UserSchema)
      expect(created.id).toBe(2)

      // PUT update
      global.fetch = mockFetch({ id: 1, name: 'John Updated', email: 'john@test.com' })
      const updated = await api
        .put('/users/:id', { params: { id: 1 }, body: { name: 'John Updated' } })
        .schema(UserSchema)
      expect(updated.name).toBe('John Updated')

      // DELETE
      global.fetch = mockFetch(null, 204)
      await api.delete('/users/:id', { params: { id: 1 } })
    })

    it('should handle validation errors with safe()', async () => {
      global.fetch = mockFetch({ invalid: 'data' })

      const api = createClient({ baseUrl: 'https://api.test.com' })
      const result = await api
        .get('/users/:id', { params: { id: 1 } })
        .schema(UserSchema)
        .safe()

      expect(result.data).toBeUndefined()
      expect(result.error).toBeInstanceOf(ValidationError)
    })

    it('should handle HTTP errors with safe()', async () => {
      global.fetch = mockFetch({ message: 'Not Found' }, 404)

      const api = createClient({ baseUrl: 'https://api.test.com' })
      const result = await api
        .get('/users/:id', { params: { id: 999 } })
        .schema(UserSchema)
        .safe()

      expect(result.data).toBeUndefined()
      expect(result.error).toBeInstanceOf(HttpError)
    })

    it('should work with response unwrapping', async () => {
      global.fetch = mockFetch({
        data: { id: 1, name: 'John', email: 'john@test.com' },
        meta: { timestamp: '2024-01-01' }
      })

      const api = createClient({
        baseUrl: 'https://api.test.com',
        unwrap: (r: any) => r.data
      })

      const user = await api
        .get('/users/:id', { params: { id: 1 } })
        .schema(UserSchema)

      expect(user).toEqual({ id: 1, name: 'John', email: 'john@test.com' })
    })
  })
})
```

**Step 2: Run integration tests**

Run: `npm test -- tests/integration-new.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integration-new.test.ts
git commit -m "test: add integration tests for new API"
```

---

## Task 11: Update README and Documentation

**Files:**
- Update: `README.md`

Update README with new API examples (as per design document).

**Commit:**
```bash
git add README.md
git commit -m "docs: update README with new API"
```

---

## Task 12: Cleanup and Final Testing

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run type checking**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Run linting**

Run: `npm run lint`
Expected: No errors

**Step 4: Build**

Run: `npm run build`
Expected: Success

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: cleanup and finalize redesign"
```

---

## Summary

Total tasks: 12
Estimated implementation time: Varies based on developer speed

Key deliverables:
1. Path parameter type extraction
2. Standard Schema integration
3. Error classes (HttpError, ValidationError, NetworkError)
4. Result type and safe mode
5. Updated RequestBuilder with schema validation
6. Response unwrapping
7. New createClient API
8. Auth helper functions
9. Updated exports
10. Integration tests
11. Updated documentation
12. Full test coverage
