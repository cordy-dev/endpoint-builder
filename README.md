# endpoint-builder

Type-safe HTTP client for TypeScript, built on native `fetch`. It has zero dependencies.

[![npm version](https://img.shields.io/npm/v/@cordy/endpoint-builder.svg)](https://www.npmjs.com/package/@cordy/endpoint-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **Typed end to end.** Path params come from the URL string. Query, body, response and error bodies come from your schemas. The API is inspired by Elysia/Eden.
- **Any Standard Schema validator.** Works with [Standard Schema](https://standardschema.dev) libraries: zod, valibot, arktype, effect, yup, … Plain functions go through `schema(fn)`.
- **Immutable, lazy requests.** A client is a plain options object (`createClient(options)`), and every request is an immutable builder. Partially configured builders are safe to reuse.
- **Typed endpoint contracts.** Describe an API once, bind it to a client and get a typed SDK. Params, query, headers, body, response and errors are all typed.
- **Typed streams.** Server-Sent Events and NDJSON arrive as an async iterable of validated items.
- **Test without a network.** `mockClient(contract, handlers)` answers your contract with typed handlers, through the real client.
- **Errors you can check.** Each failure has its own class: `HttpError<404, NotFound>`, `NetworkError`, `TimeoutError`, `AbortError`, `ValidationError` and `ParseError`. They share a `type` discriminator, and `.safe()` returns them as a `Result`.
- **Reliable defaults:**
  - Per-attempt timeouts that also cover a slow body.
  - Retries only idempotent methods by default, with backoff, jitter and `Retry-After`.
  - Single-flight token refresh that can't loop.
  - Dedupe keeps each caller's abort separate.
  - Connections are released for discarded bodies.
- **Lifecycle hooks** (`onRequest`, `onResponse`, `onSuccess`, `onError`, `onRetry`) on the client and on single requests, plus a **middleware pipeline**.

```bash
npm install @cordy/endpoint-builder
```

## Quick start

```ts
import { createClient } from "@cordy/endpoint-builder";
import { z } from "zod";

const User = z.object({ id: z.number(), name: z.string() });

const api = createClient({ baseUrl: "https://api.example.com", auth: token });

const user = await api.get("/users/:id", { params: { id: 1 } }).returns(User);
//    ^? { id: number; name: string }

const created = await api.post("/users", { json: { name: "Ann" } }).returns(User);
```

Requests are **lazy**: nothing is sent until you `await` the builder or call `send()`, `safe()` or `raw()`.

## Creating a client

`createClient(options)` is the recommended way. The result is an immutable `Client`.

```ts
import { bearer, createClient } from "@cordy/endpoint-builder";

const api = createClient({
  baseUrl: "https://api.example.com",
  headers: { "X-App": "web" },
  timeout: 10_000,                // per attempt, default 30s
  auth: bearer(() => store.token),
  retry: { limit: 3 },            // default: 2 retries of idempotent requests
  errors: { 401: Unauthorized },  // typed error bodies shared by every request
  middleware: [logging],
  onError: report,                // hooks: onRequest / onResponse / onError / onRetry
});

// derive new clients, the parent is untouched; headers merge, error types accumulate
const admin = api.with({ headers: { "X-Role": "admin" } });
const v2 = api.with({ baseUrl: "https://api.example.com/v2", errors: { 422: Problem } });
```

Prefer chaining? `Client.builder(url)` is an optional fluent alternative. Every method maps 1:1 to an option:

```ts
const api = Client.builder("https://api.example.com")
  .timeout(10_000)
  .auth(bearer(() => store.token))
  .errors({ 401: Unauthorized })
  .build();
```

<details>
<summary>All client options</summary>

| Option | Default | |
|---|---|---|
| `baseUrl` | `""` | Prepended to relative paths |
| `headers` | `{}` | Default headers |
| `query` | — | Default query params, merged with the request query |
| `timeout` | `30_000` | Per-attempt timeout in ms (`false` = none) |
| `retry` | `{}` | `RetryOptions`, a number (limit) or `false` |
| `auth` | `false` | `AuthStrategy` or a bearer token string |
| `dedupe` | `false` | Collapse identical concurrent GET/HEAD requests |
| `fetch` | `globalThis.fetch` | Custom fetch (tests, SSR, proxies) |
| `middleware` | `[]` | Middleware, outermost first |
| `onRequest` / `onResponse` / `onError` / `onRetry` | — | Lifecycle hooks |
| `unwrap` | — | Extract payload from an envelope (`b => b.data`) before validation |
| `querySerializer` | `{ arrayFormat: "repeat" }` | `repeat` / `brackets` / `indices` / `comma`, or a function |
| `errors` | `{}` | Error body schemas by status code |
| `init` | `{}` | Extra `fetch` init: `credentials`, `cache`, `mode`, … |
| `responseType` | `"auto"` | `auto` / `json` / `text` / `blob` / `arrayBuffer` / `formData` / `stream` |

</details>

## Requests

```ts
const users = await api
  .get("/users", { query: { page: 2, tags: ["a", "b"], filter: { role: "admin" } } })
  // → /users?page=2&tags=a&tags=b&filter[role]=admin
  .header("X-Trace", id)
  .timeout(5_000)
  .retry(false)
  .signal(controller.signal)
  .returns(z.array(User));
```

A builder is a description of a request, and every method returns a new one:

```ts
const listUsers = api.get("/users").returns(UserList);
const page1 = await listUsers.query({ page: 1 });
const page2 = await listUsers.query({ page: 2 });
```

### Path params

`/users/:id`, optional `/:id?`, `/files/:name.json` and OpenAPI-style `/{id}` are all typed. Values are URI-encoded. If a param is missing, you get a compile-time error, and a `ValidationError` at runtime.

```ts
api.get("/users/:userId/posts/:postId", { params: { userId: 1, postId: 2 } });
api.get("/users/:id"); // ❌ compile error: params are required
```

### Bodies

```ts
api.post("/users", { json: data });                      // JSON
api.post("/users").json(data, CreateUser);               // JSON, validated before sending
api.post("/upload").body(formData);                      // native bodies are passed through
api.post("/login").form({ user, password });             // x-www-form-urlencoded
api.post("/avatar").multipart({ file: blob, name: "a" }); // multipart, boundary set by fetch
```

### Responses

```ts
await api.get("/x");                     // unknown, decoded by Content-Type
await api.get("/x").returns(Schema);     // validated and typed
await api.get("/x").as<Thing>();         // typed, no runtime check
await api.get("/x").text();              // also .blob() .arrayBuffer() .formData() .stream()
await api.get("/x").returns(User).map(u => u.name);  // composable transforms
const res = await api.get("/x").send();  // { data, status, headers, response, request }
const native = await api.get("/x").raw(); // native Response, no status check
```

## Validation

Every schema slot takes a **[Standard Schema](https://standardschema.dev)**. Tested with zod 4, valibot 1 and arktype 2; any other Standard Schema library (effect/schema, yup ≥ 1.7, …) should work the same way.

The input type is inferred from the schema input and the data type from the schema output, so transforms and coercions are typed correctly. Sync validators run synchronously, without an extra await.

For a one-off check, wrap a function with `schema(fn)`. Throw to reject; the message becomes the validation issue:

```ts
import { schema } from "@cordy/endpoint-builder";

const Even = schema((value) => {
  if (typeof value !== "number" || value % 2) throw new Error("expected an even number");
  return value;
});
api.get("/count").returns(Even);  // number
```

The input type of `schema(fn)` is `unknown`. Use a schema library when you need a typed `body` or `query`.

## Typed endpoint contracts

Describe the API once, Elysia-style, and bind it to any client:

```ts
import { createClient, defineContract, endpoint } from "@cordy/endpoint-builder";

export const contract = defineContract({
  users: {
    list:   endpoint.get("/users").query(ListQuery).returns(z.array(User)),
    get:    endpoint.get("/users/:id").returns(User).errors({ 404: NotFound }),
    create: endpoint.post("/users").body(CreateUser).returns(User).errors({ 422: Problem }),
    remove: endpoint.delete("/users/:id"),
  },
  health: endpoint.get("/health").as<{ status: "ok" }>(),
});

const api = createClient({ baseUrl, auth }).api(contract);

const user = await api.users.get({ params: { id: 1 } });   // User
await api.users.create({ body: { name: "Ann", email: "a@b.co" } }); // body typed from CreateUser input
await api.users.list();                                     // input optional, nothing is required
await api.users.get({ params: { id: 1 } }).timeout(1000).safe(); // still a RequestBuilder
```

Helper types: `EndpointInput<E>`, `EndpointData<E>`, `EndpointErrors<E>`.

### Typed headers

```ts
const contract = defineContract({
  me: endpoint.get("/me").headers(z.object({ "x-tenant": z.string() })).as<Me>(),
  list: endpoint.get("/list").defaultHeaders({ "x-client": "web" }), // constant headers
});

await api.me({ headers: { "x-tenant": "acme" } }); // required, validated, then sent
await api.me();                                    // ❌ compile error
```

Headers become optional when every field is optional or has a default. Without `.headers(schema)`, `headers` accepts any extra headers.

## Streaming (SSE and NDJSON)

`.sse()` and `.ndjson()` resolve, after the status check, with an `EventStream`: an async iterable of validated items.

```ts
const stream = await api.get("/chat", { query: { q } }).sse(ChatEvent, { stopOn: "[DONE]" });
for await (const event of stream) {
  event; // ChatEvent
}

// in a contract
const contract = defineContract({
  chat: endpoint.get("/chat").query(ChatQuery).sse(ChatEvent),
  export: endpoint.get("/export").ndjson(Row),
});
for await (const row of await api.export()) { ... }

// errors come before the first item, so safe() works as usual
const { data: stream, error } = await api.chat({ query }).safe();
```

- Without a schema `.sse()` yields raw `SseMessage`s: `{ event, data, id, retry }`.
- An invalid or malformed item ends the stream with a `ValidationError` or `ParseError`. Use `{ onInvalid: "skip" }` to drop such items instead.
- `break` or `stream.cancel()` closes the connection. A user `AbortSignal` cancels the stream, which then throws `AbortError`. A dropped connection throws `NetworkError`.
- The `timeout` covers the wait for the response, not the lifetime of the stream.
- A stream is read once. Each `await` of the request opens a new connection, and streams are never deduped.

## Errors and `.safe()`

Every error extends `EndpointError` and has a `type` discriminator:

| Class | `type` | When |
|---|---|---|
| `HttpError<Status, Body>` | `http` | Non-2xx response. `body` is parsed, and validated if a schema is declared |
| `NetworkError` | `network` | DNS, connection or CORS failure |
| `TimeoutError` | `timeout` | The per-attempt timeout elapsed |
| `AbortError` | `abort` | Your `AbortSignal` fired |
| `ValidationError` | `validation` | A schema rejected `params` / `query` / `body` / `response` / `error` |
| `ParseError` | `parse` | Malformed JSON body |

```ts
const { data, error } = await api.users.get({ params: { id } }).safe();

if (isHttpError(error, 404)) {
  error.body;            // { message: string }, typed from .errors({ 404: NotFound })
} else if (error?.type === "validation") {
  error.stage;           // "response"
  error.issues;
} else if (error) {
  throw error;
} else {
  data;                  // User
}
```

Credential-like query parameters (`api_key`, `token`, `signature`, …) are masked as `***` in `error.message` and `error.request.url`, so errors are safe to log or hand to an LLM.

`safe()` only catches library errors. Bugs in your own code, such as an exception inside `map()`, are still thrown.

## Retries

```ts
createClient({
  retry: {
    limit: 2,                    // retries after the first attempt
    methods: ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"], // idempotent only by default
    statusCodes: [408, 425, 429, 500, 502, 503, 504],
    backoff: "exponential",      // | "linear" | "constant" | (attempt) => ms
    delay: 300, maxDelay: 30_000, jitter: true,
    retryAfter: true,            // honour Retry-After (number = cap in ms)
    networkErrors: true, timeouts: true,
    shouldRetry: ({ response, error, attempt }) => undefined, // undefined → default rules
  },
});

api.post("/payments").retry({ methods: ["POST"], limit: 5 }); // opt in per request
```

Backoff sleeps can be aborted. Bodies of failed attempts are discarded, so keep-alive sockets are released. Stream bodies are never replayed.

## Authentication

```ts
import { apiKey, basic, bearer, refreshable } from "@cordy/endpoint-builder/auth";

bearer("token");                         // or bearer(() => store.token), async allowed
apiKey(key);                             // X-API-Key header
apiKey(key, { query: "api_key" });       // ?api_key=…
basic("user", "pässword");               // UTF-8 safe

refreshable({
  getToken: () => store.access,
  refresh: async () => { store.access = await renewToken(store.refresh); },
});
```

`refreshable` reacts to `401` (configurable). Concurrent failures share **one** refresh, and each request is replayed **at most once**. Credentials are applied on every attempt. Use `.auth(false)` for anonymous requests. To write your own strategy, implement `{ apply(ctx), shouldRefresh?(res), refresh?(ctx, res) }`.

## Hooks

Hooks have names that tell you when they run. Set them on the client, or on a single request. Client hooks run first.

```ts
const api = createClient({
  baseUrl,
  onRequest:  ctx => { ctx.headers.set("x-id", newId()); },     // before sending, once per request
  onResponse: (response, ctx) => { log(response.status); },     // when the response arrives; return a Response to replace it
  onSuccess:  (data, response) => { metrics.ok(response.request.url); }, // final data, after validation and map()
  onError:    (error, ctx) => { report(error); },               // library errors; throw to replace the error
  onRetry:    ({ attempt, delay, error, response }) => { ... }, // before a failed attempt is retried
});

const user = await api.get("/users/:id", { params: { id } }).returns(User)
  .onRequest(ctx => ctx.headers.set("x-trace", traceId))
  .onSuccess(user => cache.set(user.id, user))   // register after returns()/map() so `user` has its final type
  .onError(error => toast(error.message));
```

## Middleware

For code that wraps the whole call (timing, caching, mocking), use middleware:

```ts
import type { Middleware } from "@cordy/endpoint-builder";

const timing: Middleware = async (ctx, next) => {
  const started = performance.now();
  try {
    return await next(ctx);
  } finally {
    console.log(ctx.method, ctx.url, ctx.meta.feature, performance.now() - started);
  }
};

const api = createClient({ baseUrl, middleware: [timing] });
await api.get("/search").meta("feature", "search");
```

The pipeline is composed once per client. From outermost to innermost:

`hooks → dedupe → your middleware → retry → auth → fetch`

Middleware can mutate `ctx` (url, headers, body, …), short-circuit with its own `Response` (caching), or post-process the response. With `dedupe: true`, middleware runs once per shared network call, while hooks run for every caller.

## Testing

`@cordy/endpoint-builder/testing` answers your contract without a network. Requests still go through the real client: parameters, query, headers and body are validated, and responses and error bodies are validated and decoded.

```ts
import { mockClient } from "@cordy/endpoint-builder/testing";

const api = mockClient(contract, {
  users: {
    get: ({ params }) => ({ id: Number(params.id), name: "Ann" }),    // return type checked against the contract
    remove: (_input, { fail }) => fail(404, { message: "no user" }),   // body typed from .errors({ 404: ... })
  },
  events: () => [{ n: 1 }, { n: 2 }],                                  // streams: any (async) iterable
});

await api.users.get({ params: { id: 1 } }); // { id: 1, name: "Ann" }
```

- Handlers receive `{ params, query, headers, body }` as they arrive on the wire (`params` and `query` are strings) and a typed `fail(status, body)`.
- Endpoints without a handler answer `501` with `[mock] no handler for GET /users/1`.
- Retries and the timeout are off by default. Pass client options as the third argument: `mockClient(contract, handlers, { auth, errors })`.
- To test a client you configured yourself, inject `mockFetch(contract, handlers)` with `createClient({ fetch })`.

## Result helpers

`ok`, `err`, `isOk`, `isErr`, `unwrap`, `unwrapOr`, `mapResult`, `mapError`.

## Migrating from 1.x

See [MIGRATION.md](./MIGRATION.md).

## License

MIT
