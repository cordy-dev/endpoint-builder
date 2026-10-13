# endpoint-builder

Type-safe HTTP client for TypeScript, built on native `fetch`. It has zero dependencies.

[![npm version](https://img.shields.io/npm/v/@cordy/endpoint-builder.svg)](https://www.npmjs.com/package/@cordy/endpoint-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **Typed end to end.** Path params come from the URL string. Query, body, response and error bodies come from your schemas. The API is inspired by Elysia/Eden.
- **Any validator.** It works with [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, effect, yup, …), with `parse()` objects and with plain functions.
- **Immutable fluent builders.** The client and request builders work like .NET `IHttpClientBuilder`. Every call returns a new builder, so partially configured builders are safe to reuse.
- **Typed endpoint contracts.** Describe an API once, bind it to a client and get a typed SDK.
- **Errors you can check.** Each failure has its own class: `HttpError<404, NotFound>`, `NetworkError`, `TimeoutError`, `AbortError`, `ValidationError` and `ParseError`. They share a `type` discriminator, and `.safe()` returns them as a `Result`.
- **Reliable defaults:**
  - Per-attempt timeouts that also cover a slow body.
  - Retries only idempotent methods by default, with backoff, jitter and `Retry-After`.
  - Single-flight token refresh that can't loop.
  - Dedupe keeps each caller's abort separate.
  - Connections are released for discarded bodies.
- **Middleware pipeline** in the style of `DelegatingHandler`, plus lifecycle hooks.

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

## Building a client

Use options or the fluent builder. Both produce the same immutable `Client`.

```ts
import { Client, bearer } from "@cordy/endpoint-builder";

const api = Client.builder("https://api.example.com")
  .header("X-App", "web")
  .timeout(10_000)                // per attempt, default 30s
  .auth(bearer(() => store.token))
  .retry({ limit: 3 })            // default: 2 retries of idempotent requests
  .errors({ 401: Unauthorized })  // typed error bodies shared by every request
  .use(logging)                   // middleware
  .onError(report)                // hooks: onRequest / onResponse / onError / onRetry
  .build();

// derive new clients, the parent is untouched
const admin = api.with({ headers: { "X-Role": "admin" } });
const v2 = api.extend(b => b.baseUrl("https://api.example.com/v2"));
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

Every schema slot accepts:

- any **Standard Schema**: zod ≥ 3.24, valibot ≥ 1, arktype ≥ 2, effect/schema, yup ≥ 1.7, …
- an object with **`parse(value)`**
- a **function** `(value) => output` that throws when the value is invalid

The input type is inferred from the schema input and the data type from the schema output, so transforms and coercions are typed correctly. Sync validators run synchronously, without an extra await.

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

## Middleware and hooks

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

const api = Client.builder(baseUrl).use(timing).build();
await api.get("/search").meta("feature", "search");
```

The pipeline is composed once per client. From outermost to innermost:

`hooks → dedupe → your middleware → retry → auth → fetch`

Middleware can mutate `ctx` (url, headers, body, …), short-circuit with its own `Response` (caching, mocking), or post-process the response.

## Result helpers

`ok`, `err`, `isOk`, `isErr`, `unwrap`, `unwrapOr`, `mapResult`, `mapError`.

## Migrating from 1.x

See [MIGRATION.md](./MIGRATION.md).

## License

MIT
