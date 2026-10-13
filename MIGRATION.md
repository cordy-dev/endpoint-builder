# Migrating from 1.x to 2.0

2.0 is a redesign. The ideas stay the same (builders, schemas, `.safe()`), but the API is now consistent. It also fixes several 1.x bugs that silently changed behaviour. See "Behaviour fixes" below.

## Entry points

| 1.x | 2.0 |
|---|---|
| `createClient` (typed), `createUniversalClient`, `SimpleClient`, `UniversalClient`, `TypedClient`, `HttpClient` | `createClient(options \| baseUrl)` / `Client.builder()` → `Client` |
| `@cordy/endpoint-builder/storage` | removed. Keep tokens in your own store and pass getters to `bearer` / `refreshable` |
| `ExponentialRetryStrategy`, `RetryStrategy` classes | `retry: RetryOptions \| number \| false` |
| `ApiKeyStrategy`, `OpaqueTokenStrategy` | `apiKey()`, `refreshable()` |
| `bearerAuth`, `apiKeyAuth`, `basicAuth`, `refreshAuth` | `bearer`, `apiKey`, `basic`, `refreshable` |
| `requestInterceptors` / `responseInterceptors` | `middleware`, `onRequest`, `onResponse`, `onError` |

## Client options

```diff
 createClient({
   baseUrl,
-  auth: "token",                 // still works (bearer shorthand)
-  apiKey: "k",
+  auth: apiKey("k"),
-  authStrategy: myStrategy,
+  auth: myStrategy,
-  retry: true, retryStrategy: new ExponentialRetryStrategy({ maxAttempts: 3 }),
+  retry: { limit: 2 },           // maxAttempts counted the first try, limit counts retries only
-  dedupe: true,                  // was on by default
+  dedupe: true,                  // now off by default, and only for GET/HEAD
-  requestInterceptors: [{ onRequest: cfg => cfg }],
+  onRequest: ctx => { ctx.headers.set("x", "1"); },
 });
```

## Requests

```diff
-api.get("/users/:id", { params: { id: 1 } }).schema(User)
+api.get("/users/:id", { params: { id: 1 } }).returns(User)

-api.post("/users", { body: data })
+api.post("/users", { json: data })        // or { body } for auto encoding

-.schema(User).transform(fn)
+.returns(User).map(fn)

-await api.get("/x").data()
+await api.get("/x")                        // builders are thenable

-api.get("/x").send()  // HttpResponse with plain-object headers
+api.get("/x").send()  // HttpResponse with native Headers + response + request

-.form(data, false)    // multipart with broken boundary
+.multipart(data)
-.form(data)           // claimed urlencoded but sent FormData
+.form(data)           // real application/x-www-form-urlencoded
```

## Errors and Result

```diff
-if (result.error instanceof HttpError)    // never true in 1.x, plain Errors were thrown
+if (isHttpError(result.error, 404)) result.error.body   // typed body

-error.response.data                        // always undefined
+error.body                                 // parsed error body
```

`Result` now also carries `ok: boolean`. `unwrapResult` was renamed to `unwrap`, and `mapErr` to `mapError`.

## Query serialization

Nested objects are serialized with brackets (`filter[role]=admin`) instead of JSON. To get the old behaviour back, pass a custom `querySerializer`.

## Behaviour fixes you may notice

- `timeout()` and `signal()` were ignored in 1.x. They now work. The default timeout is 30s per attempt.
- Network errors were never retried and were thrown as `Error("HTTP fetch")`. They are now retried (idempotent methods only) and thrown as `NetworkError`.
- POST/PATCH are no longer retried unless you opt in with `retry({ methods: [...] })`.
- `refreshAuth` could loop forever on repeated 401s. `refreshable` replays a request once and shares one refresh between concurrent requests.
- Dedupe merged POSTs and uploads with different bodies (`JSON.stringify(FormData) === "{}"`) and ignored headers. It is now GET/HEAD only, the key includes the headers, and each caller gets its own `Response` clone.
- `ApiKeyStrategy(..., asQueryParam=true)` never added the key. `apiKey(key, { query })` does.
- `buildPath("/a/:idx/:id")` replaced `:idx` with the value of `id`, and values weren't URL-encoded.
- `.data()` JSON-parsed any text response that looked like JSON. Decoding now follows `Content-Type` only.
- The `./auth`, `./retry` and `./storage` subpath exports pointed at files that were never built. `./auth`, `./retry` and `./errors` are now built and exported.
