import type { EndpointDefinition } from "../contract";
import { type Contract, Endpoint, type EndpointData, type EndpointErrors, type Unset } from "../contract";
import { type Api, type ClientOptions, createApi, type ErrorsOf } from "../core/client";
import type { InferOutput } from "../schema";
import type { EventStream, SseMessage } from "../stream";
import type { FetchLike, MaybePromise, Simplify } from "../types";
import { compilePath, type OptionalParamNames, type RequiredParamNames } from "../utils/path";

/** A canned error response. Create it with the typed `fail` helper passed to handlers. */
export class MockFailure {
	constructor(
		readonly status: number,
		readonly body?: unknown,
	) {}
}

/**
 * `fail(404, body)` — for a status declared with `.errors()` the body is required and typed,
 * any other status takes an optional body of any type.
 */
export type Failer<TErrors> = <S extends number>(
	status: S,
	...body: S extends keyof TErrors ? [body: TErrors[S]] : [body?: unknown]
) => MockFailure;

export interface MockTools<TErrors> {
	fail: Failer<TErrors>;
}

/** What the "server" receives: path params and query as sent on the wire, the body as the client serialized it */
export type MockInput<E> =
	E extends Endpoint<infer S>
		? {
				params: Simplify<
					{ [K in RequiredParamNames<S["path"]>]: string } & { [K in OptionalParamNames<S["path"]>]?: string }
				>;
				query: Record<string, string | string[]>;
				headers: Headers;
				body: [S["body"]] extends [Unset] ? unknown : InferOutput<S["body"]>;
			}
		: never;

/** Items of a mocked stream. Raw SSE (`.sse()` without a schema) takes a string or a partial message. */
type MockItem<T> = [T] extends [SseMessage] ? ([SseMessage] extends [T] ? string | Partial<SseMessage> : T) : T;

/** Streams are mocked with any (async) iterable of items */
export type MockData<D> = D extends EventStream<infer T> ? Iterable<MockItem<T>> | AsyncIterable<MockItem<T>> : D;

export type MockHandler<E> = (
	input: MockInput<E>,
	tools: MockTools<EndpointErrors<E>>,
) => MaybePromise<MockData<EndpointData<E>> | MockFailure>;

/** Handlers mirroring the shape of the contract. Endpoints without a handler answer `501`. */
export type MockHandlers<C> = {
	[K in keyof C]?: C[K] extends Endpoint<any> ? MockHandler<C[K]> : MockHandlers<C[K]>;
};

const DEFAULT_BASE_URL = "http://mock.test";

interface Route {
	method: string;
	regex: RegExp;
	names: string[];
	definition: EndpointDefinition;
	handler: (input: unknown, tools: unknown) => unknown;
	specificity: number;
}

function collect(contract: Contract, handlers: Record<string, unknown> | undefined, routes: Route[]): void {
	for (const key of Object.keys(contract)) {
		const entry = contract[key]!;
		const handler = handlers?.[key];
		if (entry instanceof Endpoint) {
			if (typeof handler !== "function") continue;
			const { regex, names } = compilePath(entry.definition.path);
			routes.push({
				method: entry.definition.method,
				regex,
				names,
				definition: entry.definition,
				handler: handler as Route["handler"],
				specificity: names.length,
			});
		} else {
			collect(entry, handler as Record<string, unknown> | undefined, routes);
		}
	}
}

const JSON_HEADERS = { "content-type": "application/json" };

function parseQuery(url: URL): Record<string, string | string[]> {
	const query: Record<string, string | string[]> = {};
	for (const [key, value] of url.searchParams) {
		const previous = query[key];
		query[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
	}
	return query;
}

function readBody(init: RequestInit): unknown {
	const body = init.body;
	if (body === undefined || body === null) return undefined;
	if (typeof body === "string") {
		return new Headers(init.headers).get("content-type")?.includes("json") ? JSON.parse(body) : body;
	}
	if (body instanceof URLSearchParams) return Object.fromEntries(body);
	return body; // FormData, Blob, ...
}

function encodeSseItem(item: unknown, raw: boolean): string {
	if (!raw) return `data: ${JSON.stringify(item)}\n\n`;
	const message = typeof item === "string" ? { data: item } : (item as Partial<SseMessage>);
	let out = "";
	if (message.event) out += `event: ${message.event}\n`;
	if (message.id) out += `id: ${message.id}\n`;
	for (const line of String(message.data ?? "").split("\n")) out += `data: ${line}\n`;
	return `${out}\n`;
}

function streamResponse(items: Iterable<unknown> | AsyncIterable<unknown>, definition: EndpointDefinition): Response {
	const kind = definition.stream!.kind;
	const raw = definition.stream!.schema === undefined;
	const iterator: Iterator<unknown> | AsyncIterator<unknown> =
		Symbol.asyncIterator in items ? items[Symbol.asyncIterator]() : items[Symbol.iterator]();
	const encoder = new TextEncoder();

	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await iterator.next();
			if (next.done) controller.close();
			else
				controller.enqueue(
					encoder.encode(kind === "sse" ? encodeSseItem(next.value, raw) : `${JSON.stringify(next.value)}\n`),
				);
		},
		async cancel() {
			await iterator.return?.();
		},
	});
	return new Response(body, {
		headers: { "content-type": kind === "sse" ? "text/event-stream" : "application/x-ndjson" },
	});
}

function toResponse(result: unknown, definition: EndpointDefinition): Response {
	if (result instanceof MockFailure) {
		return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
			status: result.status,
			headers: JSON_HEADERS,
		});
	}
	if (definition.stream) return streamResponse(result as Iterable<unknown> | AsyncIterable<unknown>, definition);
	if (result === undefined) return new Response(null, { status: 204 });
	return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
}

export interface MockFetchOptions {
	/** Must match the client `baseUrl` (default `http://mock.test`) */
	baseUrl?: string;
}

/**
 * A `fetch` that answers the endpoints of `contract` with `handlers` — no network involved.
 * Inject it with `createClient({ fetch })` to test a fully configured client (auth, retries, hooks, ...).
 */
export function mockFetch<const C extends Contract>(
	contract: C,
	handlers: MockHandlers<C>,
	options: MockFetchOptions = {},
): FetchLike {
	const routes: Route[] = [];
	collect(contract, handlers, routes);
	routes.sort((a, b) => a.specificity - b.specificity);

	const basePath = new URL(options.baseUrl ?? DEFAULT_BASE_URL).pathname.replace(/\/$/, "");
	const fail = (status: number, body?: unknown) => new MockFailure(status, body);

	return async (input, init) => {
		const url = new URL(input);
		const method = (init.method ?? "GET").toUpperCase();
		const pathname =
			(basePath && url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname) || "/";

		for (const route of routes) {
			if (route.method !== method) continue;
			const match = route.regex.exec(pathname);
			if (!match) continue;

			const params: Record<string, string> = {};
			route.names.forEach((name, index) => {
				const value = match[index + 1];
				if (value !== undefined) params[name] = decodeURIComponent(value);
			});
			const result = await route.handler(
				{ params, query: parseQuery(url), headers: new Headers(init.headers), body: readBody(init) },
				{ fail },
			);
			return toResponse(result, route.definition);
		}
		return new Response(`[mock] no handler for ${method} ${pathname}`, {
			status: 501,
			headers: { "content-type": "text/plain" },
		});
	};
}

/**
 * A client bound to `contract` that is answered by `handlers`. Requests still pass through the real
 * client: parameters, query, headers and body are validated, responses are validated and decoded.
 * Retries and the timeout are off by default.
 *
 * ```ts
 * const api = mockClient(contract, {
 *   users: {
 *     get: ({ params }) => ({ id: Number(params.id), name: "Ann" }),
 *     remove: (_input, { fail }) => fail(404, { message: "no user" }),
 *   },
 * });
 * ```
 */
export function mockClient<const C extends Contract, const O extends ClientOptions = {}>(
	contract: C,
	handlers: MockHandlers<C>,
	options?: O,
): Api<C, ErrorsOf<O>> {
	const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
	const merged = {
		retry: false,
		timeout: false,
		...options,
		baseUrl,
		fetch: mockFetch(contract, handlers, { baseUrl }),
	};
	// tsc needs this cast (the spread loses the generic O); the type-aware rule does not see why
	// oxlint-disable-next-line typescript/no-unnecessary-type-assertion
	return createApi(contract, merged as unknown as O) as unknown as Api<C, ErrorsOf<O>>;
}
