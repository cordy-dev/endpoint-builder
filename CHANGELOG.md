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
- Typed endpoint contracts: `endpoint.get(...)`, `defineContract()` and `createApi(contract, options)`, which returns the typed endpoints plus `$client` and `$with`.
- Typed error bodies per status code at client and request level. `isHttpError(error, status)` narrows the body to the declared type.
- Validation with any Standard Schema v1 library (zod, valibot, arktype, effect, yup) for params, query, body, response and error bodies. `schema(fn)` wraps a plain function.
- `Endpoint` takes a single spec generic: `Endpoint<{ method; path; params; query; body; data; errors }>`.
- Error classes: `TimeoutError`, `AbortError`, `ParseError` and the `EndpointError` base class. All errors carry a `type` discriminator.
- Lifecycle hooks `onRequest`, `onResponse`, `onSuccess`, `onError` and `onRetry`, on the client and on single requests (`request.onSuccess(...)`), plus a middleware pipeline.
- Typed streams: `.sse(schema?, { stopOn, onInvalid })` and `.ndjson(schema, { onInvalid })` resolve with an `EventStream` of validated items. Available on requests and in contracts (`endpoint.get(...).sse(Event)`).
- Typed endpoint headers: `endpoint.get(...).headers(schema)` makes `headers` a validated, typed input. `defaultHeaders()` sets constant headers.
- `@cordy/endpoint-builder/testing`: `mockClient(contract, handlers)` and `mockFetch(contract, handlers)` answer a contract with typed handlers and a typed `fail(status, body)`.
- `maxBytes` option for `.sse()` and `.ndjson()`: the stream ends with a `SizeLimitError` after that many bytes, which also bounds an endless line.
- `.idempotent()` (on requests and contract endpoints): sends an `Idempotency-Key` header, one key per call shared by its retries, and lets the retry policy retry POST and PATCH.
- Limits: `concurrency` and `rateLimit` queue requests (aborting a queued request never touches the network, retries count too); `maxResponseBytes` rejects oversized bodies with the new `SizeLimitError` (`type: "size"`) without reading them.
- Documentation for AI coding assistants: `llms.txt` (rules and common mistakes) and `llms-full.txt` (README and migration guide in one file) ship in the package; `AGENTS.md` / `CLAUDE.md` guide agents working on this repository. A test keeps `llms-full.txt` in sync (`bun run docs:llms`).
- Path params: optional params (`:id?`), OpenAPI style (`{id}`) and `:name.json`. Values are URI-encoded.
- Configurable query serialization with `repeat`, `brackets`, `indices` or `comma` array formats, and nested objects.
- `fetch` injection, `init` passthrough and default query params.
- `refreshable` auth: single-flight refresh that replays a request at most once.

### Fixed

- Credentials in the query string (`apiKey(key, { query })` or `token=...` passed by the caller) no longer leak into error messages and `error.request.url`; they are masked as `***`.
- Timeouts and abort signals are now applied. The timeout also covers reading the body.
- Network errors are retried and thrown as `NetworkError`.
- Error classes are actually thrown, so `instanceof` works.
- Token refresh can no longer loop forever.
- Dedupe no longer merges POSTs, uploads or requests with different headers.
- Subpath exports (`./auth`, `./retry`, `./errors`, `./testing`) are now built.
- A user `AbortSignal` keeps working after the response headers arrived (relevant for bodies and streams read later). The minimum Node version is now 20.3 (`AbortSignal.any`).
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
