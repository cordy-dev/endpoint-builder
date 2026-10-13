import type { AuthStrategy } from "../auth/types";
import { type ClientCore, type ErrorSchemas, type InferErrors, type MergeErrors, RequestBuilder, type RequestState } from "../core/request";
import type { ErrorMap } from "../errors";
import type { RetryInput } from "../retry";
import type { InferInput, InferOutput, Schema } from "../schema";
import type { EventStream, NdjsonOptions, SseMessage, SseOptions, StreamSpec } from "../stream";
import type { HeadersInput, HttpMethod, QueryInput, ResponseType, Simplify } from "../types";
import type { HasParams, HasRequiredParams, PathParams } from "../utils/path";

declare const _unset: unique symbol;
/** Marker for "no schema declared" */
export type Unset = typeof _unset;

type BodylessMethod = "GET" | "HEAD" | "OPTIONS";

/** @internal runtime description of an endpoint */
export interface EndpointDefinition {
	readonly method: HttpMethod;
	readonly path: string;
	readonly paramsSchema?: Schema;
	readonly querySchema?: Schema;
	readonly bodySchema?: Schema;
	readonly bodyKind?: "auto" | "json" | "form" | "multipart";
	readonly responseSchema?: Schema;
	readonly responseType?: ResponseType;
	readonly errorSchemas?: ErrorSchemas;
	readonly headersSchema?: Schema;
	readonly defaultHeaders?: readonly HeadersInput[];
	readonly stream?: StreamSpec;
	readonly timeout?: number | false;
	readonly retry?: RetryInput;
	readonly auth?: AuthStrategy | false;
	readonly dedupe?: boolean;
	readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Type-level description of an endpoint — the single generic of `Endpoint`.
 * `Unset` in `params` / `query` / `body` means "no schema declared".
 */
export interface EndpointSpec {
	method: HttpMethod;
	path: string;
	params: unknown;
	query: unknown;
	headers: unknown;
	body: unknown;
	data: unknown;
	errors: ErrorMap;
}

type Initial<M extends HttpMethod, P extends string> = {
	method: M;
	path: P;
	params: Unset;
	query: Unset;
	headers: Unset;
	body: Unset;
	data: unknown;
	errors: {};
};

/** Replace some fields of a spec, keeping the rest (and a readable hover) */
type Patch<S, P> = { [K in keyof S]: K extends keyof P ? P[K] : S[K] };

/**
 * Immutable endpoint definition — the contract of a single route.
 * Inspired by Elysia route schemas: types for params, query, body, response and
 * error bodies all flow from the declared schemas.
 *
 * ```ts
 * const getUser = endpoint.get("/users/:id").returns(User).errors({ 404: NotFound });
 * //    ^? Endpoint<{ method: "GET"; path: "/users/:id"; data: User; errors: { 404: NotFound }; ... }>
 * ```
 */
export class Endpoint<S extends EndpointSpec = EndpointSpec> {
	declare readonly "~spec": S;

	constructor(readonly definition: EndpointDefinition) {}

	#with<E>(patch: Partial<EndpointDefinition>): E {
		return new Endpoint({ ...this.definition, ...patch }) as E;
	}

	/** Validate / coerce path params (the input type comes from the schema) */
	params<Sc extends Schema>(schema: Sc): Endpoint<Patch<S, { params: Sc }>> {
		return this.#with({ paramsSchema: schema });
	}

	/** Validate query parameters */
	query<Sc extends Schema>(schema: Sc): Endpoint<Patch<S, { query: Sc }>> {
		return this.#with({ querySchema: schema });
	}

	/**
	 * Declare typed request headers. Callers must (or may, when all fields are optional) pass them
	 * as `headers`; they are validated and sent. Use `defaultHeaders()` for constant headers.
	 */
	headers<Sc extends Schema>(schema: Sc): Endpoint<Patch<S, { headers: Sc }>> {
		return this.#with({ headersSchema: schema });
	}

	/** Validate the request body (sent as JSON unless it is a native body) */
	body<Sc extends Schema>(schema: Sc, kind: "auto" | "json" | "form" | "multipart" = "auto"): Endpoint<Patch<S, { body: Sc }>> {
		return this.#with({ bodySchema: schema, bodyKind: kind });
	}

	/** Validate the response; the data type is inferred from the schema */
	returns<Sc extends Schema>(schema: Sc): Endpoint<Patch<S, { data: InferOutput<Sc> }>> {
		return this.#with({ responseSchema: schema });
	}

	/** Declare the response type without runtime validation */
	as<T>(): Endpoint<Patch<S, { data: T }>> {
		return this as unknown as Endpoint<Patch<S, { data: T }>>;
	}

	/** Declare typed error bodies by status code */
	errors<M extends ErrorSchemas>(schemas: M): Endpoint<Patch<S, { errors: MergeErrors<S["errors"], InferErrors<M>> }>> {
		return this.#with({ errorSchemas: { ...this.definition.errorSchemas, ...schemas } });
	}

	/**
	 * Server-Sent Events. Calls resolve with an `EventStream` of validated JSON payloads
	 * (or raw `SseMessage`s when no schema is given).
	 */
	sse(): Endpoint<Patch<S, { data: EventStream<SseMessage> }>>;
	sse<Sc extends Schema>(schema: Sc, options?: SseOptions): Endpoint<Patch<S, { data: EventStream<InferOutput<Sc>> }>>;
	sse(schema?: Schema, options?: SseOptions): unknown {
		return this.#with({ stream: { kind: "sse", schema, options }, responseType: "stream" });
	}

	/** Newline-delimited JSON. Calls resolve with an `EventStream` of validated lines. */
	ndjson<Sc extends Schema>(schema: Sc, options?: NdjsonOptions): Endpoint<Patch<S, { data: EventStream<InferOutput<Sc>> }>> {
		return this.#with({ stream: { kind: "ndjson", schema, options }, responseType: "stream" });
	}

	responseType(type: ResponseType): this {
		return this.#with({ responseType: type });
	}

	/** Constant headers sent with every call of this endpoint */
	defaultHeaders(headers: HeadersInput): this {
		return this.#with({ defaultHeaders: [...(this.definition.defaultHeaders ?? []), headers] });
	}

	timeout(ms: number | false): this {
		return this.#with({ timeout: ms });
	}

	retry(retry: RetryInput): this {
		return this.#with({ retry });
	}

	auth(auth: AuthStrategy | false): this {
		return this.#with({ auth });
	}

	dedupe(enabled = true): this {
		return this.#with({ dedupe: enabled });
	}

	meta(key: string, value: unknown): this {
		return this.#with({ meta: { ...this.definition.meta, [key]: value } });
	}
}

function define<M extends HttpMethod>(method: M) {
	return <P extends string>(path: P): Endpoint<Initial<M, P>> => new Endpoint({ method, path });
}

/** Endpoint factory: `endpoint.get("/users/:id")`, `endpoint.post("/users")`, ... */
export const endpoint = {
	get: define("GET"),
	post: define("POST"),
	put: define("PUT"),
	patch: define("PATCH"),
	delete: define("DELETE"),
	head: define("HEAD"),
	options: define("OPTIONS"),
};

// ------------------------------------------------------------------- typing

type Field<K extends string, T> =
	undefined extends T ? { [P in K]?: T }
		: {} extends T ? { [P in K]?: T }
			: { [P in K]: T };

type ParamsPart<P extends string, TParams> = [TParams] extends [Unset]
	? HasRequiredParams<P> extends true ? { params: PathParams<P> }
		: HasParams<P> extends true ? { params?: PathParams<P> }
			: { params?: undefined }
	: Field<"params", InferInput<TParams>>;

type QueryPart<TQuery> = [TQuery] extends [Unset] ? { query?: QueryInput } : Field<"query", InferInput<TQuery>>;

type BodyPart<M extends HttpMethod, TBody> = [TBody] extends [Unset]
	? M extends BodylessMethod ? {} : { body?: unknown }
	: Field<"body", InferInput<TBody>>;

type HeadersPart<THeaders> = [THeaders] extends [Unset] ? { headers?: HeadersInput } : Field<"headers", InferInput<THeaders>>;

interface CommonInput {
	signal?: AbortSignal;
	timeout?: number | false;
}

/** Input object accepted by a bound endpoint */
export type EndpointInput<E> = E extends Endpoint<infer S>
	? Simplify<ParamsPart<S["path"], S["params"]> & QueryPart<S["query"]> & HeadersPart<S["headers"]> & BodyPart<S["method"], S["body"]> & CommonInput>
	: never;

/** Response data of an endpoint */
export type EndpointData<E> = E extends Endpoint<infer S> ? S["data"] : never;

/** Declared error bodies of an endpoint */
export type EndpointErrors<E> = E extends Endpoint<infer S> ? S["errors"] : never;

/** Callable produced by binding an endpoint to a client */
export type EndpointFn<E, TClientErrors extends ErrorMap> = {} extends EndpointInput<E>
	? (input?: EndpointInput<E>) => RequestBuilder<EndpointData<E>, MergeErrors<TClientErrors, EndpointErrors<E>>>
	: (input: EndpointInput<E>) => RequestBuilder<EndpointData<E>, MergeErrors<TClientErrors, EndpointErrors<E>>>;

/** Nested object of endpoints */
export interface Contract {
	readonly [key: string]: Endpoint<any> | Contract;
}

/** A contract bound to a client: every endpoint becomes a typed function */
export type BoundContract<C, TClientErrors extends ErrorMap = {}> = {
	readonly [K in keyof C]: C[K] extends Endpoint<any>
		? EndpointFn<C[K], TClientErrors>
		: BoundContract<C[K], TClientErrors>;
};

/** Identity helper that keeps literal types of a contract */
export function defineContract<const C extends Contract>(contract: C): C {
	return contract;
}

// ------------------------------------------------------------------ runtime

interface RuntimeInput {
	params?: Record<string, unknown>;
	query?: QueryInput;
	body?: unknown;
	headers?: HeadersInput | Record<string, unknown>;
	signal?: AbortSignal;
	timeout?: number | false;
}

/** @internal create a request builder for an endpoint call */
export function createEndpointRequest(core: ClientCore, def: EndpointDefinition, input: RuntimeInput = {}): RequestBuilder<any, any> {
	// with a headers schema the caller's headers are validated, otherwise they are plain extra headers
	const typedHeaders = def.headersSchema !== undefined;
	const headers = input.headers && !typedHeaders ? [...(def.defaultHeaders ?? []), input.headers as HeadersInput] : def.defaultHeaders;
	const state: RequestState = {
		method: def.method,
		path: def.path,
		params: input.params,
		paramsSchema: def.paramsSchema,
		query: input.query,
		querySchema: def.querySchema,
		hasBody: def.bodySchema !== undefined || input.body !== undefined,
		body: input.body,
		bodyKind: def.bodyKind ?? "auto",
		bodySchema: def.bodySchema,
		...(headers ? { headers } : {}),
		headersInput: typedHeaders ? input.headers : undefined,
		headersSchema: def.headersSchema,
		stream: def.stream,
		timeout: input.timeout ?? def.timeout,
		retry: def.retry,
		auth: def.auth,
		dedupe: def.dedupe,
		signal: input.signal,
		meta: def.meta,
		responseType: def.responseType,
		responseSchema: def.responseSchema,
		errorSchemas: def.errorSchemas,
	};
	return new RequestBuilder(core, state);
}

/** @internal bind every endpoint of a (nested) contract to a client core */
export function bindContract<C extends Contract>(core: ClientCore, contract: C): BoundContract<C> {
	const bound: Record<string, unknown> = {};
	for (const key of Object.keys(contract)) {
		const value = contract[key]!;
		bound[key] = value instanceof Endpoint
			? (input?: RuntimeInput) => createEndpointRequest(core, value.definition, input)
			: bindContract(core, value);
	}
	return bound as BoundContract<C>;
}
