# Changelog

## 2.0.0

A full redesign. See [MIGRATION.md](./MIGRATION.md) for the upgrade guide and [docs/plans/2026-10-13-v2-review.md](./docs/plans/2026-10-13-v2-review.md) for the review that led to it.

### Added

- Immutable `Client` created with `createClient(options)`, and `client.with(options)` for derived clients. `Client.builder()` is an optional fluent alternative.
- Immutable, lazy, thenable `RequestBuilder` with:
  - `.returns()`, `.as<T>()` and `.map()`;
  - `.errors()`, `.json(value, schema)` and `.query(value, schema)`;
  - `.form()` and `.multipart()`;
  - `.text()`, `.blob()`, `.arrayBuffer()`, `.formData()` and `.stream()`;
  - `.raw()`, `.send()` and `.safe()`;
  - `.meta()` and `.init()`.
- Typed endpoint contracts: `endpoint.get(...)`, `defineContract()` and `client.api(contract)`.
- Typed error bodies per status code at client and request level. `isHttpError(error, status)` narrows the body to the declared type.
- Validation with any Standard Schema v1 library (zod, valibot, arktype, effect, yup) for params, query, body, response and error bodies. `schema(fn)` wraps a plain function.
- `Endpoint` takes a single spec generic: `Endpoint<{ method; path; params; query; body; data; errors }>`.
- Error classes: `TimeoutError`, `AbortError`, `ParseError` and the `EndpointError` base class. All errors carry a `type` discriminator.
- Middleware pipeline and lifecycle hooks: `onRequest`, `onResponse`, `onError` and `onRetry`.
- Path params: optional params (`:id?`), OpenAPI style (`{id}`) and `:name.json`. Values are URI-encoded.
- Configurable query serialization with `repeat`, `brackets`, `indices` or `comma` array formats, and nested objects.
- `fetch` injection, `init` passthrough and default query params.
- `refreshable` auth: single-flight refresh that replays a request at most once.

### Fixed

- Timeouts and abort signals are now applied. The timeout also covers reading the body.
- Network errors are retried and thrown as `NetworkError`.
- Error classes are actually thrown, so `instanceof` works.
- Token refresh can no longer loop forever.
- Dedupe no longer merges POSTs, uploads or requests with different headers.
- Subpath exports (`./auth`, `./retry`, `./errors`) are now built.
- Non-idempotent methods are no longer retried by default.
- `apiKey` sent as a query param is now actually applied.
- `buildPath` no longer has the `:id` vs `:idx` collision, and values are encoded.
- Url-encoded and multipart form bodies are now encoded correctly.
- Error bodies are parsed and exposed as `HttpError.body`.
- Discarded response bodies are released, so keep-alive sockets are freed.
- Basic auth now works with UTF-8 credentials.

### Removed

- `UniversalClient`, `SimpleClient`, `TypedClient` and `HttpClient`.
- Interceptors, replaced by middleware and hooks.
- Retry strategy classes, replaced by `RetryOptions`.
- `ApiKeyStrategy` and `OpaqueTokenStrategy`.
- The `./storage` subpath.
