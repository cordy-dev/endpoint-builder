# endpoint-builder

Type-safe HTTP client for TypeScript, built on native `fetch`. It has zero dependencies.

[![npm version](https://img.shields.io/npm/v/@cordy/endpoint-builder.svg)](https://www.npmjs.com/package/@cordy/endpoint-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

- **Typed end to end.** Path params come from the URL string. Query, body, response and error bodies come from your schemas. The API is inspired by Elysia/Eden.
- **Any Standard Schema validator.** Works with [Standard Schema](https://standardschema.dev) libraries: zod, valibot, arktype, effect, yup, … Plain functions go through `schema(fn)`.
- **Immutable, lazy requests.** A client is a plain options object (`createClient(options)`), and every request is an immutable builder. Partially configured builders are safe to reuse.
- **Typed endpoint contracts.** Describe an API once, create an API from it with `createApi` and get a typed SDK. Params, query, headers, body, response and errors are all typed.
- **Typed streams.** Server-Sent Events and NDJSON arrive as an async iterable of validated items.
- **Test without a network.** `mockClient(contract, handlers)` answers your contract with typed handlers, through the real client.
- **Errors you can check.** Each failure has its own class: `HttpError<404, NotFound>`, `NetworkError`, `TimeoutError`, `AbortError`, `ValidationError` and `ParseError`. They share a `type` discriminator, and `.safe()` returns them as a `Result`.
- **Built for unattended callers** such as agents and workers: `.idempotent()` for safe POST retries, `concurrency` and `rateLimit` queues, `maxResponseBytes`, and credentials masked in errors.
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
| `retry` | `{}` | `RetryInput`: a `RetryOptions` object, a number (limit) or `false` |
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

Describe the API once, Elysia-style, and turn it into a typed client with `createApi`:

```ts
import { createApi, defineContract, endpoint } from "@cordy/endpoint-builder";

export const contract = defineContract({
  users: {
    list:   endpoint.get("/users").query(ListQuery).returns(z.array(User)),
    get:    endpoint.get("/users/:id").returns(User).errors({ 404: NotFound }),
    create: endpoint.post("/users").body(CreateUser).returns(User).errors({ 422: Problem }),
    remove: endpoint.delete("/users/:id"),
  },
  health: endpoint.get("/health").as<{ status: "ok" }>(),
});

const api = createApi(contract, { baseUrl, auth }); // takes the same options as createClient

const user = await api.users.get({ params: { id: 1 } });   // User
await api.users.create({ body: { name: "Ann", email: "a@b.co" } }); // body typed from CreateUser input
await api.users.list();                                     // input optional, nothing is required
await api.users.get({ params: { id: 1 } }).timeout(1000).safe(); // still a RequestBuilder

api.$client.get("/anything-else");                  // the plain client, for calls outside the contract
const admin = api.$with({ headers: { "X-Role": "admin" } }); // a derived API for the same contract
```

`$client` and `$with` are the only extra members (they are not enumerable), so a top-level contract key cannot be called `$client` or `$with`.

Helper types: `EndpointInput<E>`, `EndpointData<E>`, `EndpointErrors<E>`, `Api<C>`.

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

## Generate a client from OpenAPI

Point the generator at an OpenAPI 3.0 / 3.1 or Swagger 2.0 document (JSON, from Swagger UI, Scalar, `/openapi.json`, ...) and it writes one TypeScript file with the types, validators and a typed contract:

```bash
npx endpoint-builder generate ./openapi.json --out src/api.ts
npx endpoint-builder generate https://api.example.com/openapi.json --out src/api.ts
```

```ts
import { bearer } from "@cordy/endpoint-builder/auth";
import { createApi } from "./api"; // the generated file

const api = createApi({ auth: bearer(() => token) }); // `baseUrl` defaults to the first server of the document

const pets = await api.pets.listPets({ query: { limit: 10 }, headers: { "X-Tenant": "acme" } }); // Pet[], validated
const pet = await api.pets.getPet({ params: { petId: 7 } }).safe(); // 404 body typed from the document
await api.pets.getPet({ params: { petId: "7" } });                  // ❌ compile error: petId is a number
```

`createApi(options)` takes the same options as `createClient`. The generated file also exports `contract` (use it with `createApi(contract, options)` from the library, for example in tests with `mockClient`), `servers`, and a type and a validator for every component schema:

```ts
import { Pet, type NewPet } from "./api";

Pet["~standard"].validate(value); // every export is a Standard Schema, so it works with .body(), .returns(), ...
```

| Option | Effect |
|---|---|
| `-o, --out <file>` | Write the client to this file. Without it the code is printed. |
| `--check` | Do not write; exit with code 1 when `--out` is missing or out of date. Put it in CI so the file never drifts from the document. |
| `--group tag` (default) / `--group none` | `api.pets.listPets` (grouped by the first tag; untagged operations stay at the top) or `api.listPets`. |
| `--prefer json` (default) / `--prefer xml` | Which format to use when an operation offers both. |
| `--no-validate` | Types only: nothing is validated at runtime and the file is smaller. |
| `--import-from <module>` | Where the generated file imports the library from. |

How the document maps to calls:

| In the document | In the client |
|---|---|
| `operationId` | the method name, camel-cased (`get_user-by_id` → `getUserById`); without it, built from the method and path |
| path, query and header parameters | typed `params`, `query` and `headers` inputs; required ones are required |
| `style: form, explode: false`, `pipeDelimited`, `spaceDelimited` (and Swagger `collectionFormat`) | arrays joined with `,`, `\|` or a space |
| `application/json`, `x-www-form-urlencoded`, `multipart/form-data` bodies | `body`, sent in that format. `format: binary` is a `Blob` |
| `application/xml` | read and written with the schema's `xml` hints (`name`, `attribute`, `wrapped`, `prefix`/`namespace`) |
| `text/event-stream`, `application/x-ndjson` | `.sse(Schema)` / `.ndjson(Schema)` streams |
| `text/*` and binary responses | `string` and `Blob` |
| `2xx` responses | the return type (several different ones become a union); no content is `void` |
| `4xx` / `5xx` responses with JSON | `.errors({ 404: Problem })`, so `isHttpError(error, 404)` narrows the body |
| `servers` | the `servers` export and the default `baseUrl` |
| `summary`, `description`, `deprecated` | the JSDoc of the method |

What it does not do, and tells you about on stderr: callbacks and webhooks (they describe requests the server makes to you), cookie parameters, `$ref`s to other files (bundle the document first), `default` and `4XX` response ranges, YAML (convert it to JSON first). Security schemes are not applied: pass `auth` yourself. Check the output into your repository and review the diff when the API changes.

Validation follows JSON Schema without surprises: no type coercion, unknown properties are allowed, `format` is documentation only, and `oneOf` accepts a value that matches at least one branch. The same validator is available for hand-written schemas as `jsonSchema<T>(schema, defs)` from `@cordy/endpoint-builder/openapi`, next to `optional()`, `queryStyle()`, `unchecked<T>()`, `xmlBody()` and `xmlResponse()`, which the generated file uses. The generator itself is `generate(document, options)` from `@cordy/endpoint-builder/codegen` (Node only).

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
- `maxResponseBytes` does not apply to streams. Bound one explicitly with `{ maxBytes }`: the stream then ends with a `SizeLimitError` once it has delivered that many bytes, and it also bounds a single endless line. You can still stop earlier with `break`, `stopOn` or an `AbortSignal`.

To expose a stream from your own function, wrap it in an async generator. `yield*` forwards the values and closes the connection when the consumer stops early:

```ts
async function* events(signal?: AbortSignal) {
  const stream = await api.get("/chat").signal(signal).sse(ChatEvent);
  yield* stream;
}
```

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
| `SizeLimitError` | `size` | The body is larger than `maxResponseBytes` |

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

`retry: false` is a valid value that turns retries off. When you wrap the client options, test for `!== undefined`, not for truthiness.

Backoff sleeps can be aborted. Bodies of failed attempts are discarded, so keep-alive sockets are released. Stream bodies are never replayed.

### Safe retries of POST and PATCH

`.idempotent()` sends an `Idempotency-Key` header and lets the retry policy retry this request even though POST is not idempotent. A new key is created for every call (every `await`, including each call of a contract endpoint). Only the retries of that call share it, so the server can de-duplicate them without ever merging two separate calls:

```ts
await api.post("/payments", { json: payment }).idempotent();                      // random UUID key
await api.post("/payments", { json: payment }).idempotent("order-42");            // your own key
await api.post("/payments", { json: payment }).idempotent({ header: "X-Idempotency-Key" });
endpoint.post("/payments").idempotent()                                           // in a contract
```

## Limits

```ts
createClient({
  concurrency: 4,                          // at most 4 requests waiting for response headers at a time
  rateLimit: { requests: 10, per: 1000 },  // at most 10 requests started per second (sliding window)
  maxResponseBytes: 5_000_000,             // bigger bodies fail with SizeLimitError
});

await api.get("/export").maxResponseBytes(50_000_000);  // raise it for one request, or `false` to lift it
```

- Requests over the limit wait in a FIFO queue. Aborting a queued request removes it without touching the network.
- Retries count against the limits too, so a retry storm cannot exceed the rate. Derived clients (`api.with(...)`) share the queue unless you change `concurrency` or `rateLimit`.
- `concurrency` counts requests until their response headers arrive. Bodies and streams read later are not counted.
- `maxResponseBytes` rejects a body announced as too large (`Content-Length`) without reading it, and stops reading as soon as a chunked body passes the limit. Huge **error** bodies are truncated instead of rejected. Streams (`sse`, `ndjson`, `stream()`) and `raw()` are not limited by it; use `{ maxBytes }` on `sse()` / `ndjson()` for streams.

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

- Handlers receive `{ params, query, headers, body }` as they arrive on the wire (`params` and `query` are strings, `headers` is a native `Headers`) and a typed `fail(status, body)`.
- Routes are matched by method and path. Static paths win over parameterized ones, so `/todos/stream` is never taken for `/todos/:id`.
- Endpoints without a handler answer `501` with `[mock] no handler for GET /users/1`.
- `mockClient` has retries and the timeout off. Pass client options as the third argument: `mockClient(contract, handlers, { auth, errors })`.
- To test a client you configured yourself, inject `mockFetch(contract, handlers)` with `createClient({ fetch })`. That client keeps its own retry policy, so set `retry: { delay: 0 }` to keep tests fast.

Simulate a transient failure with `fail(503)` (the body is optional for statuses you did not declare). This checks that a retried POST carries the same `Idempotency-Key`:

```ts
let calls = 0;
const fetch = mockFetch(contract, {
  create: ({ headers }, { fail }) => (++calls === 1 ? fail(503) : { id: 1, title: "x", done: false }),
});
const api = createApi(contract, { baseUrl: "http://mock.test", fetch, retry: { delay: 0 } });
await api.create({ body: { title: "x" } }); // `create` is declared with .idempotent(); the retry reuses its key
```

## Result helpers

`ok`, `err`, `isOk`, `isErr`, `unwrap`, `unwrapOr`, `mapResult`, `mapError`.

## For AI coding assistants

The package ships two plain-text files next to the code, so an assistant can read them from `node_modules/@cordy/endpoint-builder/`:

- `llms.txt`: the rules for writing code with this library, the common mistakes, and links.
- `llms-full.txt`: the whole documentation in one file, for pasting into a context window.

Point your assistant at them, or copy the rules from `llms.txt` into your project's `AGENTS.md` / `CLAUDE.md`. If you work on this repository itself, see `AGENTS.md`.

## Migrating from 1.x

See [MIGRATION.md](./MIGRATION.md).

## License

MIT
