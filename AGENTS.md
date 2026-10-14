# AGENTS.md

Guidance for AI coding agents (and humans) working **on this repository**. If you are *using* the library in another project, read `llms.txt` instead.

## What this is

`@cordy/endpoint-builder`: a type-safe HTTP client for TypeScript on native `fetch`. Zero runtime dependencies, ESM only, Node >= 20.3. Version 2 is a full redesign of 1.x; see `docs/plans/2026-10-13-v2-review.md` for the reasoning.

## Commands

```bash
bun install --frozen-lockfile  # bun is the package manager (bun.lock)
bun run test         # vitest, includes type-level tests (expectTypeOf, @ts-expect-error). Not `bun test`: that is bun's own runner
bun run check        # tsc --noEmit, covers src and tests (also `bun check`)
bun run lint         # oxlint, type-aware (needs oxlint-tsgolint); `bun run lint:fix` fixes most things
bun run format       # oxfmt (reads .editorconfig and .oxfmtrc.json); `bun run format:check` only checks
bun run build        # tsdown -> dist/ (index, auth, retry, errors, testing)
bun run docs:llms    # regenerate llms-full.txt after editing README.md or MIGRATION.md
```

Run test, check, lint and format:check before every commit (the pre-commit hook formats and lints staged files). A test checks that `llms-full.txt` is up to date.

## Map of the code

| Path | Responsibility |
|---|---|
| `src/core/client.ts` | `Client`, `ClientBuilder`, `createClient`, option merging, pipeline assembly |
| `src/core/request.ts` | `RequestBuilder`: immutable request state, preparing the request, handling the response |
| `src/core/transport.ts` | The one place that calls `fetch`: timeout, abort, error mapping |
| `src/contract/` | `endpoint.*`, `defineContract`, binding a contract to a client; most of the type-level work |
| `src/middleware/` | `Middleware` type, `compose`, `dedupe`, `limit` (concurrency and rate limit) |
| `src/retry/`, `src/auth/` | Retry policy and middleware, auth strategies and middleware |
| `src/stream/` | SSE and NDJSON parsing, `EventStream` |
| `src/schema/` | Standard Schema types, `validate`, `schema(fn)` |
| `src/errors/`, `src/result.ts` | Error classes (all extend `EndpointError` and have a `type`), `Result` |
| `src/testing/` | `mockClient` and `mockFetch` (published as `/testing`) |
| `src/utils/` | path, query, body, headers, url (incl. redaction), decode, bounded reads |

Request pipeline, outermost first: `hooks -> dedupe -> user middleware -> retry -> auth -> limit -> fetch`.

## Conventions

- **Immutability.** Builders and clients never mutate; every method returns a new instance. Do not add mutable state to `RequestBuilder` or `Endpoint`.
- **No runtime dependencies.** Anything new must be implemented here. `zod`, `valibot` and `arktype` are dev dependencies for tests only.
- **Errors.** Every error extends `EndpointError` and has a literal `type`. A new error type must be added to `ErrorType`, to the `ApiError` union, to `src/index.ts` and to the README table.
- **Secrets never reach error text.** Build an error's request with `errorRequest(ctx)` from `src/utils/url.ts`, never `{ method, url: ctx.url }`. Query params that look like credentials are masked there.
- **Style.** Tabs, double quotes, semicolons, sorted imports. `bun run format` does the formatting and `bun run lint:fix` the safe lint fixes.
- **Types are part of the API.** A change that affects inference needs a type test (`expectTypeOf`), and a negative case with `// @ts-expect-error` when the point is to reject something.
- **Hot path.** Middleware that usually has nothing to do should be a plain function that returns `next(ctx)` synchronously, not an `async` function, so ordinary requests pay no extra promise.

## Adding a feature

1. Code in the right module, with JSDoc on every public symbol.
2. Tests in `tests/`: runtime behaviour, types, and the failure cases.
3. Export it from `src/index.ts` (and a subpath entry only if it is a separate concern).
4. Update `README.md`, `CHANGELOG.md`, and `MIGRATION.md` if it changes 1.x behaviour.
5. `bun run docs:llms`, then add a rule to `llms.txt` if users are likely to get it wrong.

## Testing notes (learned the hard way)

- **Builders are lazy.** `const r = api.get("/x");` sends nothing. Use `await`, or `.send()` when you want it to start without waiting.
- Use the helpers in `tests/helpers.ts`: `mockFetch` (records calls), `hangingFetch`, `json`, and `chunked`/`sseResponse`/`ndjsonResponse` for streams.
- `mockFetch(response)` clones the `Response`, which tees streaming bodies and makes `cancel()` wait for the other branch. For streams pass a factory, `mockFetch(() => sseResponse(...))`.
- Timing tests use real timers with wide margins (for example `>= 90` for a 100 ms window). Keep them wide, and re-run them a few times before committing.
- The timeout only guards the wait for the response and the body read. `releaseResponse(response)` stops it. Anything that hands a body to the caller must call it.
- `@ts-expect-error` must sit on the line that fails; a directive that no longer matches is itself a type error.

## Git

Work on the `v2.0.0` branch. Conventional commit messages (`feat:`, `fix:`, `refactor!:`). Do not force-push, and do not open pull requests unless asked.
