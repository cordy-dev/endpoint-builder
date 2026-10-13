import type { AuthStrategy } from "../auth/types";
import { type ApiError, EndpointError, type ErrorMap, type ErrorRequest, HttpError, ValidationError, type ValidationStage } from "../errors";
import type { Next } from "../middleware";
import { err, ok, type Result } from "../result";
import { mergeRetry, type RetryInput } from "../retry";
import { type InferInput, type InferOutput, type Schema, validate } from "../schema";
import { EventStream, type NdjsonOptions, openStream, type SseMessage, type SseOptions, type StreamSpec } from "../stream";
import type { HeadersInput, HttpMethod, HttpResponse, OnErrorHook, OnRequestHook, OnResponseHook, OnRetryHook, OnSuccessHook, QueryInput, RequestContext, RequestInitExtras, ResponseType, Simplify } from "../types";
import { type FormInput, isNativeBody, toFormData, toUrlEncoded } from "../utils/body";
import { decodeBody, decodeErrorBody } from "../utils/decode";
import { applyHeaders, headersFromRecord } from "../utils/headers";
import { buildPath } from "../utils/path";
import { appendQuery, serializeQuery } from "../utils/query";
import { joinUrl } from "../utils/url";
import type { ClientConfig, Unwrap } from "./config";
import { releaseResponse, toTransportError } from "./transport";

/** Map of status code → schema */
export type ErrorSchemas = Record<number, Schema>;
/** `{ 404: NotFoundSchema }` → `{ 404: NotFound }` */
export type InferErrors<M> = { [K in keyof M]: InferOutput<M[K]> };
export type MergeErrors<A, B> = Simplify<Omit<A, keyof B> & B>;

type BodyKind = "auto" | "json" | "form" | "multipart";
type MapFn = (data: any, response: HttpResponse<any>) => unknown;

/** @internal what a request needs from its client */
export interface ClientCore {
	readonly config: ClientConfig;
	readonly pipeline: Next;
}

/** @internal immutable request description */
export interface RequestState {
	readonly method: HttpMethod;
	readonly path: string;
	readonly params?: Readonly<Record<string, unknown>> | undefined;
	readonly paramsSchema?: Schema | undefined;
	readonly query?: QueryInput | Readonly<Record<string, unknown>> | undefined;
	readonly querySchema?: Schema | undefined;
	readonly hasBody?: boolean;
	readonly body?: unknown;
	readonly bodyKind?: BodyKind;
	readonly bodySchema?: Schema | undefined;
	readonly headers?: readonly HeadersInput[];
	/** User supplied headers validated by `headersSchema` (typed endpoint headers) */
	readonly headersInput?: unknown;
	readonly headersSchema?: Schema | undefined;
	readonly hooks?: StateHooks | undefined;
	readonly stream?: StreamSpec | undefined;
	readonly timeout?: number | false | undefined;
	readonly retry?: RetryInput | undefined;
	readonly auth?: AuthStrategy | false | undefined;
	readonly dedupe?: boolean | undefined;
	readonly signal?: AbortSignal | undefined;
	readonly init?: RequestInitExtras | undefined;
	readonly meta?: Readonly<Record<string, unknown>> | undefined;
	readonly responseType?: ResponseType | undefined;
	readonly responseSchema?: Schema | undefined;
	readonly errorSchemas?: ErrorSchemas | undefined;
	readonly unwrap?: Unwrap | false | undefined;
	readonly maps?: readonly MapFn[];
}

/** @internal hooks registered on a single request */
export interface StateHooks {
	readonly onRequest: readonly OnRequestHook[];
	readonly onResponse: readonly OnResponseHook[];
	readonly onRetry: readonly OnRetryHook[];
	readonly onSuccess: readonly OnSuccessHook<any>[];
	readonly onError: readonly OnErrorHook[];
}

const NO_HOOKS: StateHooks = { onRequest: [], onResponse: [], onRetry: [], onSuccess: [], onError: [] };

async function check(schema: Schema, value: unknown, stage: ValidationStage, request: ErrorRequest): Promise<any> {
	let outcome = validate(schema, value);
	if (outcome instanceof Promise) outcome = await outcome;
	if (!outcome.success) throw new ValidationError(stage, outcome.issues, value, request, outcome.cause);
	return outcome.value;
}

const ACCEPT_JSON = "application/json, text/plain, */*";

/**
 * Immutable, lazily executed request description.
 *
 * Every configuration method returns a *new* builder, so partially configured
 * builders can be shared and reused safely. Nothing is sent until the builder is
 * awaited (or `send()` / `safe()` / `raw()` is called); each await sends a new request.
 *
 * @typeParam TData   - type of the response data
 * @typeParam TErrors - map of declared error bodies by status code
 */
export class RequestBuilder<TData = unknown, TErrors extends ErrorMap = {}> implements PromiseLike<TData> {
	readonly #core: ClientCore;
	readonly #state: RequestState;

	/** @internal use `client.get(...)` & co. */
	constructor(core: ClientCore, state: RequestState) {
		this.#core = core;
		this.#state = state;
	}

	#with<D = TData, E extends ErrorMap = TErrors>(patch: Partial<RequestState>): RequestBuilder<D, E> {
		return new RequestBuilder<D, E>(this.#core, { ...this.#state, ...patch });
	}

	/** HTTP method of this request */
	get method(): HttpMethod {
		return this.#state.method;
	}

	/** Path template of this request */
	get path(): string {
		return this.#state.path;
	}

	// ------------------------------------------------------------------ request

	/** Set path parameters (validated with `schema` when given) */
	params<S extends Schema>(value: InferInput<S>, schema: S): RequestBuilder<TData, TErrors>;
	params(value: Record<string, unknown>): RequestBuilder<TData, TErrors>;
	params(value: Record<string, unknown>, schema?: Schema): RequestBuilder<TData, TErrors> {
		return this.#with({ params: value, paramsSchema: schema ?? this.#state.paramsSchema });
	}

	/** Set query parameters (validated with `schema` when given). Merged on top of client defaults. */
	query<S extends Schema>(value: InferInput<S>, schema: S): RequestBuilder<TData, TErrors>;
	query(value: QueryInput): RequestBuilder<TData, TErrors>;
	query(value: unknown, schema?: Schema): RequestBuilder<TData, TErrors> {
		return this.#with({ query: value as QueryInput, querySchema: schema ?? this.#state.querySchema });
	}

	/** Set one header (`null` removes a client default) */
	header(name: string, value: string | number | boolean | null): RequestBuilder<TData, TErrors> {
		return this.headers({ [name]: value });
	}

	/** Merge headers (`null`/`undefined` values remove client defaults) */
	headers(headers: HeadersInput): RequestBuilder<TData, TErrors> {
		return this.#with({ headers: [...(this.#state.headers ?? []), headers] });
	}

	/** JSON body (validated with `schema` before sending when given) */
	json<S extends Schema>(value: InferInput<S>, schema: S): RequestBuilder<TData, TErrors>;
	json(value: unknown): RequestBuilder<TData, TErrors>;
	json(value: unknown, schema?: Schema): RequestBuilder<TData, TErrors> {
		return this.#with({ hasBody: true, body: value, bodyKind: "json", bodySchema: schema ?? this.#state.bodySchema });
	}

	/**
	 * Body with automatic encoding: `FormData`, `Blob`, `URLSearchParams`, `ArrayBuffer`,
	 * typed arrays, streams and strings are sent as-is, everything else as JSON.
	 */
	body<S extends Schema>(value: InferInput<S>, schema: S): RequestBuilder<TData, TErrors>;
	body(value: unknown): RequestBuilder<TData, TErrors>;
	body(value: unknown, schema?: Schema): RequestBuilder<TData, TErrors> {
		return this.#with({ hasBody: true, body: value, bodyKind: "auto", bodySchema: schema ?? this.#state.bodySchema });
	}

	/** `application/x-www-form-urlencoded` body */
	form(value: FormInput | URLSearchParams): RequestBuilder<TData, TErrors> {
		return this.#with({ hasBody: true, body: value, bodyKind: "form" });
	}

	/** `multipart/form-data` body (boundary handled by fetch) */
	multipart(value: FormInput | FormData): RequestBuilder<TData, TErrors> {
		return this.#with({ hasBody: true, body: value, bodyKind: "multipart" });
	}

	/** Per-attempt timeout in ms (`false` disables the client default) */
	timeout(ms: number | false): RequestBuilder<TData, TErrors> {
		return this.#with({ timeout: ms });
	}

	/** Cancel the request with an `AbortSignal` */
	signal(signal: AbortSignal | undefined): RequestBuilder<TData, TErrors> {
		return this.#with({ signal });
	}

	/** Override the retry policy (merged on top of the client policy; `false` disables) */
	retry(retry: RetryInput): RequestBuilder<TData, TErrors> {
		return this.#with({ retry });
	}

	/** Override authentication (`false` = anonymous request) */
	auth(auth: AuthStrategy | false): RequestBuilder<TData, TErrors> {
		return this.#with({ auth });
	}

	/** Share one network call between identical concurrent GET/HEAD requests */
	dedupe(enabled = true): RequestBuilder<TData, TErrors> {
		return this.#with({ dedupe: enabled });
	}

	/** Extra `fetch` options (`credentials`, `cache`, `mode`, `keepalive`, ...) */
	init(init: RequestInitExtras): RequestBuilder<TData, TErrors> {
		return this.#with({ init: { ...this.#state.init, ...init } });
	}

	/** Attach metadata readable by middleware through `ctx.meta` */
	meta(key: string, value: unknown): RequestBuilder<TData, TErrors> {
		return this.#with({ meta: { ...this.#state.meta, [key]: value } });
	}

	// ----------------------------------------------------------------- response

	/** Validate the response with a schema; the data type is inferred from it. Clears earlier `map()` calls. */
	returns<S extends Schema>(schema: S): RequestBuilder<InferOutput<S>, TErrors> {
		return this.#with({ responseSchema: schema, maps: [] });
	}

	/** Declare the response type without runtime validation */
	as<T>(): RequestBuilder<T, TErrors> {
		return this as unknown as RequestBuilder<T, TErrors>;
	}

	/**
	 * Declare typed error bodies per status code. Declared bodies are validated and
	 * `isHttpError(error, status)` narrows `error.body` to the schema output.
	 */
	errors<M extends ErrorSchemas>(schemas: M): RequestBuilder<TData, MergeErrors<TErrors, InferErrors<M>>> {
		return this.#with({ errorSchemas: { ...this.#state.errorSchemas, ...schemas } });
	}

	/** Transform the (validated) data. Transforms compose in order. */
	map<U>(fn: (data: TData, response: HttpResponse<TData>) => U): RequestBuilder<Awaited<U>, TErrors> {
		return this.#with({ maps: [...(this.#state.maps ?? []), fn as MapFn] });
	}

	/** Override the client `unwrap` for this request (`false` disables it) */
	unwrap(fn: Unwrap | false): RequestBuilder<TData, TErrors> {
		return this.#with({ unwrap: fn });
	}

	/** Choose how the body is read */
	responseType(type: ResponseType): RequestBuilder<TData, TErrors> {
		return this.#with({ responseType: type });
	}

	/** Read the body as text */
	text(): RequestBuilder<string, TErrors> {
		return this.#with({ responseType: "text", responseSchema: undefined, maps: [], stream: undefined });
	}

	/** Read the body as `Blob` */
	blob(): RequestBuilder<Blob, TErrors> {
		return this.#with({ responseType: "blob", responseSchema: undefined, maps: [], stream: undefined });
	}

	/** Read the body as `ArrayBuffer` */
	arrayBuffer(): RequestBuilder<ArrayBuffer, TErrors> {
		return this.#with({ responseType: "arrayBuffer", responseSchema: undefined, maps: [], stream: undefined });
	}

	/** Read the body as `FormData` */
	formData(): RequestBuilder<FormData, TErrors> {
		return this.#with({ responseType: "formData", responseSchema: undefined, maps: [], stream: undefined });
	}

	/** Get the body stream without reading it */
	stream(): RequestBuilder<ReadableStream<Uint8Array> | null, TErrors> {
		return this.#with({ responseType: "stream", responseSchema: undefined, maps: [], stream: undefined });
	}

	/**
	 * Read the body as Server-Sent Events. Resolves (after the status check) with an async iterable
	 * of validated JSON payloads. Without a schema it yields raw `SseMessage`s.
	 *
	 * ```ts
	 * const stream = await api.get("/chat").sse(ChatEvent, { stopOn: "[DONE]" });
	 * for await (const event of stream) event; // ChatEvent
	 * ```
	 */
	sse(): RequestBuilder<EventStream<SseMessage>, TErrors>;
	sse<S extends Schema>(schema: S, options?: SseOptions): RequestBuilder<EventStream<InferOutput<S>>, TErrors>;
	sse(schema?: Schema, options?: SseOptions): RequestBuilder<EventStream<any>, TErrors> {
		return this.#with({ responseType: "stream", responseSchema: undefined, maps: [], stream: { kind: "sse", schema, options } });
	}

	/** Read the body as newline-delimited JSON. Resolves with an async iterable of validated lines. */
	ndjson<S extends Schema>(schema: S, options?: NdjsonOptions): RequestBuilder<EventStream<InferOutput<S>>, TErrors> {
		return this.#with({ responseType: "stream", responseSchema: undefined, maps: [], stream: { kind: "ndjson", schema, options } });
	}

	// -------------------------------------------------------------------- hooks
	// Request hooks run after the client hooks of the same name.

	#hook<K extends keyof StateHooks>(key: K, hook: StateHooks[K][number]): RequestBuilder<TData, TErrors> {
		const hooks = this.#state.hooks ?? NO_HOOKS;
		return this.#with({ hooks: { ...hooks, [key]: [...hooks[key], hook] } });
	}

	/** Runs before the request is sent (once per request, not per retry attempt) */
	onRequest(hook: OnRequestHook): RequestBuilder<TData, TErrors> {
		return this.#hook("onRequest", hook);
	}

	/** Runs when the response arrives (before status handling). Return a `Response` to replace it. */
	onResponse(hook: OnResponseHook): RequestBuilder<TData, TErrors> {
		return this.#hook("onResponse", hook);
	}

	/** Runs before a failed attempt is retried */
	onRetry(hook: OnRetryHook): RequestBuilder<TData, TErrors> {
		return this.#hook("onRetry", hook);
	}

	/**
	 * Runs with the final data (after validation and `map()`). Throwing fails the request.
	 * Register it after `returns()` / `map()` so `data` has the final type.
	 */
	onSuccess(hook: OnSuccessHook<TData>): RequestBuilder<TData, TErrors> {
		return this.#hook("onSuccess", hook);
	}

	/** Runs when the request fails with a library error. Throwing replaces the error. */
	onError(hook: OnErrorHook): RequestBuilder<TData, TErrors> {
		return this.#hook("onError", hook);
	}

	// ---------------------------------------------------------------- execution

	/** Send and resolve with data + response metadata. Rejects with an `ApiError`. */
	async send(): Promise<HttpResponse<TData>> {
		let ctx: RequestContext | undefined;
		try {
			ctx = await this.#prepare();
			const response = await this.#core.pipeline(ctx);
			return await this.#handle(response, ctx);
		} catch (error) {
			throw await this.#fail(error, ctx);
		}
	}

	/** Send and return a `Result` instead of throwing. Only programming errors (non-`ApiError`) still throw. */
	async safe(): Promise<Result<TData, ApiError<TErrors>>> {
		try {
			return ok((await this.send()).data);
		} catch (error) {
			if (error instanceof EndpointError) return err(error as ApiError<TErrors>);
			throw error;
		}
	}

	/** Send and return the native `Response` without status checks or decoding */
	async raw(): Promise<Response> {
		let ctx: RequestContext | undefined;
		try {
			ctx = await this.#prepare();
			const response = await this.#core.pipeline(ctx);
			releaseResponse(response);
			return response;
		} catch (error) {
			throw await this.#fail(error, ctx);
		}
	}

	then<R1 = TData, R2 = never>(
		onfulfilled?: ((value: TData) => R1 | PromiseLike<R1>) | null,
		onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
	): Promise<R1 | R2> {
		return this.send().then(response => response.data).then(onfulfilled, onrejected);
	}

	catch<R = never>(onrejected?: ((reason: any) => R | PromiseLike<R>) | null): Promise<TData | R> {
		return this.then(undefined, onrejected);
	}

	finally(onfinally?: (() => void) | null): Promise<TData> {
		return this.then().finally(onfinally);
	}

	get [Symbol.toStringTag](): string {
		return "RequestBuilder";
	}

	// ---------------------------------------------------------------- internals

	async #prepare(): Promise<RequestContext> {
		const { config } = this.#core;
		const state = this.#state;
		const request: ErrorRequest = { method: state.method, url: state.path };

		let params = state.params;
		// omitted params/query are validated as `{}` so all-optional object schemas accept them (matches the input types)
		if (state.paramsSchema) params = await check(state.paramsSchema, params ?? {}, "params", request);
		let path: string;
		try {
			path = buildPath(state.path, params);
		} catch (error) {
			throw new ValidationError("params", [{ message: (error as Error).message }], params, request, error);
		}

		let query = state.query;
		if (state.querySchema) query = await check(state.querySchema, query ?? {}, "query", request);
		const url = appendQuery(joinUrl(config.baseUrl, path), buildQueryString(config, query));

		const headers = headersFromRecord(config.headers);
		if (state.headers) for (const patch of state.headers) applyHeaders(headers, patch);
		if (state.headersSchema) {
			const validated = await check(state.headersSchema, state.headersInput ?? {}, "headers", request);
			applyHeaders(headers, validated as HeadersInput);
		}
		const responseType = state.responseType ?? config.responseType;
		if (!headers.has("accept")) {
			if (state.stream) headers.set("accept", state.stream.kind === "sse" ? "text/event-stream" : "application/x-ndjson");
			else if (responseType === "auto" || responseType === "json") headers.set("accept", ACCEPT_JSON);
		}

		let body: BodyInit | undefined;
		if (state.hasBody) {
			let value = state.body;
			if (state.bodySchema) value = await check(state.bodySchema, value, "body", { method: state.method, url });
			body = encodeBody(value, state.bodyKind ?? "auto", headers);
		}

		const timeout = state.timeout === false ? undefined : state.timeout ?? config.timeout;
		return {
			url,
			method: state.method,
			headers,
			body,
			signal: state.signal,
			timeout,
			retry: mergeRetry(config.retry, state.retry),
			auth: state.auth ?? config.auth,
			dedupe: state.stream ? false : state.dedupe ?? config.dedupe,
			init: state.init ? { ...config.init, ...state.init } : config.init,
			attempt: 0,
			meta: { ...state.meta },
			hooks: state.hooks,
		};
	}

	async #handle(response: Response, ctx: RequestContext): Promise<HttpResponse<TData>> {
		const { config } = this.#core;
		const state = this.#state;
		const request: ErrorRequest = { method: ctx.method, url: ctx.url };
		const responseType = state.responseType ?? config.responseType;

		try {
			if (!response.ok) throw await this.#httpError(response, request);

			let data: unknown;
			if (state.stream) {
				// the timeout covers the wait for the response, not the lifetime of the stream
				releaseResponse(response);
				data = openStream(response, request, ctx.signal, state.stream);
			} else if (responseType === "stream") {
				releaseResponse(response);
				data = response.body;
			} else {
				try {
					data = await decodeBody(response, responseType, request);
				} catch (error) {
					throw toTransportError(error, ctx, false);
				} finally {
					releaseResponse(response);
				}
			}

			if (responseType === "auto" || responseType === "json") {
				const unwrap = state.unwrap === false ? undefined : state.unwrap ?? config.unwrap;
				if (unwrap && data !== undefined) data = unwrap(data);
			}
			if (state.responseSchema) data = await check(state.responseSchema, data, "response", request);

			const result = {
				data: data as TData,
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
				response,
				request: ctx,
			};
			if (state.maps?.length) {
				for (const fn of state.maps) {
					result.data = await fn(result.data, result) as TData;
				}
			}
			for (const hook of config.hooks.onSuccess) await hook(result.data, result);
			if (state.hooks) for (const hook of state.hooks.onSuccess) await hook(result.data, result);
			return result;
		} finally {
			releaseResponse(response);
		}
	}

	async #httpError(response: Response, request: ErrorRequest): Promise<HttpError> {
		let body: unknown;
		try {
			body = await decodeErrorBody(response, request);
		} finally {
			releaseResponse(response);
		}
		const schema = this.#state.errorSchemas?.[response.status] ?? this.#core.config.errors[response.status];
		if (schema) body = await check(schema, body, "error", request);
		return new HttpError(response.status, response.statusText, body, response.headers, response, request);
	}

	async #fail(error: unknown, ctx: RequestContext | undefined): Promise<unknown> {
		if (error instanceof EndpointError) {
			for (const hook of this.#core.config.hooks.onError) await hook(error, ctx);
			if (this.#state.hooks) for (const hook of this.#state.hooks.onError) await hook(error, ctx);
		}
		return error;
	}
}

function isQueryObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !(value instanceof URLSearchParams);
}

/** Client default query + request query (request wins for object inputs) */
function buildQueryString(config: ClientConfig, query: RequestState["query"]): string {
	const defaults = config.query;
	if (!defaults) return serializeQuery(query, config.querySerializer);
	if (query === undefined || query === null) return config.querySerializer(defaults);
	if (isQueryObject(query)) return config.querySerializer({ ...defaults, ...query });
	const own = serializeQuery(query, config.querySerializer);
	const base = config.querySerializer(defaults);
	return base && own ? `${base}&${own}` : base || own;
}

function hasContentType(headers: Headers): boolean {
	return headers.has("content-type");
}

function encodeBody(value: unknown, kind: BodyKind, headers: Headers): BodyInit | undefined {
	switch (kind) {
		case "form":
			return toUrlEncoded(value as FormInput);
		case "multipart":
			// fetch must generate the boundary itself
			headers.delete("content-type");
			return toFormData(value as FormInput);
		case "json":
			if (!hasContentType(headers)) headers.set("content-type", "application/json");
			return value === undefined ? undefined : JSON.stringify(value);
		default:
			if (value === undefined || value === null) return undefined;
			if (isNativeBody(value)) return value;
			if (!hasContentType(headers)) headers.set("content-type", "application/json");
			return JSON.stringify(value);
	}
}
