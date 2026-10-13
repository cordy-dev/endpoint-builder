import { authMiddleware, bearer } from "../auth";
import type { AuthStrategy } from "../auth/types";
import { bindContract, type BoundContract, type Contract } from "../contract";
import type { ErrorMap } from "../errors";
import { compose, type Middleware } from "../middleware";
import { dedupeMiddleware } from "../middleware/dedupe";
import { mergeRetry, normalizeRetry, type RetryInput, retryMiddleware } from "../retry";
import type { HeadersInput, HttpMethod, QueryInput, QueryObject, RequestInitExtras, ResponseType } from "../types";
import { toHeaderRecord } from "../utils/headers";
import type { HasRequiredParams, PathParams } from "../utils/path";
import { createQuerySerializer, defaultQuerySerializer, type QuerySerializer, type QuerySerializerOptions } from "../utils/query";
import type { ClientConfig, Hooks, OnErrorHook, OnRequestHook, OnResponseHook, OnRetryHook, Unwrap } from "./config";
import { type ClientCore, type ErrorSchemas, type InferErrors, type MergeErrors, RequestBuilder, type RequestState } from "./request";
import { createTransport } from "./transport";

// ------------------------------------------------------------------ options

type OneOrMany<T> = T | readonly T[];

/** Error map declared through `options.errors` */
type ErrorsOf<O> = O extends { errors: infer E extends ErrorSchemas } ? InferErrors<E> : {};

export interface ClientOptions<TErrorSchemas extends ErrorSchemas = ErrorSchemas> {
	/** Prepended to relative paths */
	baseUrl?: string;
	/** Default headers */
	headers?: HeadersInput;
	/** Default query parameters (merged with per-request query) */
	query?: QueryObject;
	/** Per-attempt timeout in ms (default `30_000`, `false` disables) */
	timeout?: number | false;
	/** Retry policy (default: 2 retries of idempotent requests). `false` disables. */
	retry?: RetryInput;
	/** Auth strategy, or a string used as Bearer token */
	auth?: AuthStrategy | string | false;
	/** Collapse identical concurrent GET/HEAD requests (default `false`) */
	dedupe?: boolean;
	/** Custom fetch implementation (testing, SSR, proxies, ...) */
	fetch?: (input: string, init: RequestInit) => Promise<Response>;
	/** Middleware, outermost first */
	middleware?: readonly Middleware[];
	onRequest?: OneOrMany<OnRequestHook>;
	onResponse?: OneOrMany<OnResponseHook>;
	onError?: OneOrMany<OnErrorHook>;
	onRetry?: OneOrMany<OnRetryHook>;
	/** Extract the payload from an envelope, e.g. `body => body.data` (applied before validation) */
	unwrap?: Unwrap;
	/** Query serialization: options or a custom function */
	querySerializer?: QuerySerializer | QuerySerializerOptions;
	/** Error body schemas shared by every request */
	errors?: TErrorSchemas;
	/** Extra `fetch` options: `credentials`, `cache`, `mode`, ... */
	init?: RequestInitExtras;
	/** Default response reading mode (default `auto`) */
	responseType?: ResponseType;
}

const EMPTY_HOOKS: Hooks = { onRequest: [], onResponse: [], onError: [], onRetry: [] };

const DEFAULT_CONFIG: ClientConfig = {
	baseUrl: "",
	headers: {},
	query: undefined,
	timeout: 30_000,
	retry: {},
	auth: false,
	dedupe: false,
	fetch: undefined,
	middleware: [],
	hooks: EMPTY_HOOKS,
	unwrap: undefined,
	querySerializer: defaultQuerySerializer,
	errors: {},
	init: {},
	responseType: "auto",
};

function many<T>(value: OneOrMany<T> | undefined): readonly T[] {
	return value === undefined ? [] : Array.isArray(value) ? value as readonly T[] : [value as T];
}

function toAuth(auth: AuthStrategy | string | false): AuthStrategy | false {
	return typeof auth === "string" ? bearer(auth.replace(/^Bearer\s+/i, "")) : auth;
}

/** Apply options on top of an existing config (used by both `createClient` and `client.with`) */
function applyOptions(base: ClientConfig, options: ClientOptions): ClientConfig {
	const hooks: Hooks = {
		onRequest: [...base.hooks.onRequest, ...many(options.onRequest)],
		onResponse: [...base.hooks.onResponse, ...many(options.onResponse)],
		onError: [...base.hooks.onError, ...many(options.onError)],
		onRetry: [...base.hooks.onRetry, ...many(options.onRetry)],
	};
	return {
		baseUrl: options.baseUrl ?? base.baseUrl,
		headers: options.headers ? { ...base.headers, ...toHeaderRecord(options.headers) } : base.headers,
		query: options.query ? { ...base.query, ...options.query } : base.query,
		timeout: options.timeout === false ? undefined : options.timeout ?? base.timeout,
		retry: options.retry === undefined ? base.retry : mergeRetry(base.retry, options.retry),
		auth: options.auth === undefined ? base.auth : toAuth(options.auth),
		dedupe: options.dedupe ?? base.dedupe,
		fetch: options.fetch ?? base.fetch,
		middleware: options.middleware ? [...base.middleware, ...options.middleware] : base.middleware,
		hooks,
		unwrap: options.unwrap ?? base.unwrap,
		querySerializer: options.querySerializer === undefined ? base.querySerializer
			: typeof options.querySerializer === "function" ? options.querySerializer
				: createQuerySerializer(options.querySerializer),
		errors: options.errors ? { ...base.errors, ...options.errors } : base.errors,
		init: options.init ? { ...base.init, ...options.init } : base.init,
		responseType: options.responseType ?? base.responseType,
	};
}

// ------------------------------------------------------------------ builder

/**
 * Fluent, immutable client builder (in the spirit of .NET `IHttpClientBuilder`).
 * Each call returns a new builder; error schemas accumulate in the type.
 *
 * ```ts
 * const api = new ClientBuilder()
 *   .baseUrl("https://api.example.com")
 *   .header("X-App", "web")
 *   .timeout(10_000)
 *   .auth(bearer(() => store.token))
 *   .retry({ limit: 3 })
 *   .errors({ 401: Unauthorized })
 *   .use(logger)
 *   .build();
 * ```
 */
export class ClientBuilder<TErrors extends ErrorMap = {}> {
	readonly #config: ClientConfig;

	constructor(config: ClientConfig = DEFAULT_CONFIG) {
		this.#config = config;
	}

	#with<E extends ErrorMap = TErrors>(options: ClientOptions): ClientBuilder<E> {
		return new ClientBuilder<E>(applyOptions(this.#config, options));
	}

	baseUrl(url: string): ClientBuilder<TErrors> {
		return this.#with({ baseUrl: url });
	}

	header(name: string, value: string | number | boolean | null): ClientBuilder<TErrors> {
		return this.#with({ headers: { [name]: value } });
	}

	headers(headers: HeadersInput): ClientBuilder<TErrors> {
		return this.#with({ headers });
	}

	query(query: QueryObject): ClientBuilder<TErrors> {
		return this.#with({ query });
	}

	timeout(ms: number | false): ClientBuilder<TErrors> {
		return this.#with({ timeout: ms });
	}

	retry(retry: RetryInput): ClientBuilder<TErrors> {
		return new ClientBuilder<TErrors>({ ...this.#config, retry: normalizeRetry(retry) });
	}

	auth(auth: AuthStrategy | string | false): ClientBuilder<TErrors> {
		return this.#with({ auth });
	}

	dedupe(enabled = true): ClientBuilder<TErrors> {
		return this.#with({ dedupe: enabled });
	}

	fetch(fetch: NonNullable<ClientOptions["fetch"]>): ClientBuilder<TErrors> {
		return this.#with({ fetch });
	}

	/** Add middleware (runs in registration order, outermost first) */
	use(...middleware: Middleware[]): ClientBuilder<TErrors> {
		return this.#with({ middleware });
	}

	onRequest(hook: OnRequestHook): ClientBuilder<TErrors> {
		return this.#with({ onRequest: hook });
	}

	onResponse(hook: OnResponseHook): ClientBuilder<TErrors> {
		return this.#with({ onResponse: hook });
	}

	onError(hook: OnErrorHook): ClientBuilder<TErrors> {
		return this.#with({ onError: hook });
	}

	onRetry(hook: OnRetryHook): ClientBuilder<TErrors> {
		return this.#with({ onRetry: hook });
	}

	unwrap(fn: Unwrap | undefined): ClientBuilder<TErrors> {
		return new ClientBuilder<TErrors>({ ...this.#config, unwrap: fn });
	}

	querySerializer(serializer: QuerySerializer | QuerySerializerOptions): ClientBuilder<TErrors> {
		return this.#with({ querySerializer: serializer });
	}

	/** Declare error bodies shared by all requests (accumulates in the type) */
	errors<M extends ErrorSchemas>(schemas: M): ClientBuilder<MergeErrors<TErrors, InferErrors<M>>> {
		return this.#with({ errors: schemas });
	}

	init(init: RequestInitExtras): ClientBuilder<TErrors> {
		return this.#with({ init });
	}

	responseType(type: ResponseType): ClientBuilder<TErrors> {
		return this.#with({ responseType: type });
	}

	/** Apply a plain options object */
	with<O extends ClientOptions>(options: O): ClientBuilder<MergeErrors<TErrors, ErrorsOf<O>>> {
		return this.#with(options);
	}

	/** Snapshot of the resolved configuration */
	get config(): ClientConfig {
		return this.#config;
	}

	build(): Client<TErrors> {
		return new Client<TErrors>(this.#config);
	}
}

// ------------------------------------------------------------------- client

type BaseRequestOptions = {
	query?: QueryInput;
	headers?: HeadersInput;
	signal?: AbortSignal;
	timeout?: number | false;
};

type BodyRequestOptions = BaseRequestOptions & {
	/** JSON body */
	json?: unknown;
	/** Auto-encoded body (native bodies as-is, others as JSON) */
	body?: unknown;
};

type ParamsOption<P extends string> = string extends P
	? { params?: Record<string, string | number | bigint | boolean> }
	: HasRequiredParams<P> extends true ? { params: PathParams<P> } : { params?: PathParams<P> };

/** Options for requests without a body */
export type RequestOptions<P extends string> = BaseRequestOptions & ParamsOption<P>;
/** Options for requests with a body */
export type BodyOptions<P extends string> = BodyRequestOptions & ParamsOption<P>;

type Args<P extends string, O> = HasRequiredParams<P> extends true ? [options: O] : [options?: O];

/**
 * Configured HTTP client. Immutable: `with()` / `extend()` derive new clients.
 * The middleware pipeline is composed once, at construction time.
 */
export class Client<TErrors extends ErrorMap = {}> {
	readonly #core: ClientCore;

	constructor(config: ClientConfig = DEFAULT_CONFIG) {
		const { hooks } = config;
		const layers: Middleware[] = [];
		if (hooks.onRequest.length || hooks.onResponse.length) layers.push(hooksMiddleware(hooks));
		layers.push(dedupeMiddleware(), ...config.middleware, retryMiddleware(hooks.onRetry), authMiddleware());
		this.#core = { config, pipeline: compose(layers, createTransport(config.fetch)) };
	}

	/** Start a fluent builder */
	static builder(baseUrl?: string): ClientBuilder {
		const builder = new ClientBuilder();
		return baseUrl === undefined ? builder : builder.baseUrl(baseUrl);
	}

	/** Resolved configuration */
	get config(): ClientConfig {
		return this.#core.config;
	}

	#request(method: HttpMethod, path: string, options: (BodyRequestOptions & { params?: Record<string, unknown> }) | undefined): RequestBuilder<unknown, TErrors> {
		const state: RequestState = { method, path };
		if (!options) return new RequestBuilder(this.#core, state);
		const { params, query, headers, signal, timeout, json, body } = options;
		return new RequestBuilder(this.#core, {
			...state,
			params,
			query,
			signal,
			...(headers ? { headers: [headers] } : {}),
			...(timeout !== undefined ? { timeout } : {}),
			...(json !== undefined ? { hasBody: true, body: json, bodyKind: "json" as const }
				: body !== undefined ? { hasBody: true, body, bodyKind: "auto" as const } : {}),
		});
	}

	get<P extends string>(path: P, ...[options]: Args<P, RequestOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("GET", path, options);
	}

	head<P extends string>(path: P, ...[options]: Args<P, RequestOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("HEAD", path, options);
	}

	options<P extends string>(path: P, ...[options]: Args<P, RequestOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("OPTIONS", path, options);
	}

	delete<P extends string>(path: P, ...[options]: Args<P, BodyOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("DELETE", path, options);
	}

	post<P extends string>(path: P, ...[options]: Args<P, BodyOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("POST", path, options);
	}

	put<P extends string>(path: P, ...[options]: Args<P, BodyOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("PUT", path, options);
	}

	patch<P extends string>(path: P, ...[options]: Args<P, BodyOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request("PATCH", path, options);
	}

	/** Request with an arbitrary method */
	request<P extends string>(method: HttpMethod, path: P, ...[options]: Args<P, BodyOptions<P>>): RequestBuilder<unknown, TErrors> {
		return this.#request(method, path, options);
	}

	/**
	 * Bind a contract of endpoints to this client:
	 * ```ts
	 * const api = client.api({ users: { get: endpoint.get("/users/:id").returns(User) } });
	 * const user = await api.users.get({ params: { id: 1 } });
	 * ```
	 */
	api<const C extends Contract>(contract: C): BoundContract<C, TErrors> {
		return bindContract(this.#core, contract) as BoundContract<C, TErrors>;
	}

	/** Derive a client with extra options */
	with<O extends ClientOptions>(options: O): Client<MergeErrors<TErrors, ErrorsOf<O>>> {
		return new Client(applyOptions(this.#core.config, options));
	}

	/** Derive a client through the fluent builder */
	extend<E extends ErrorMap>(configure: (builder: ClientBuilder<TErrors>) => ClientBuilder<E>): Client<E> {
		return configure(new ClientBuilder<TErrors>(this.#core.config)).build();
	}

	/** Builder pre-filled with this client's configuration */
	toBuilder(): ClientBuilder<TErrors> {
		return new ClientBuilder<TErrors>(this.#core.config);
	}
}

function hooksMiddleware(hooks: Hooks): Middleware {
	return async (ctx, next) => {
		for (const hook of hooks.onRequest) await hook(ctx);
		let response = await next(ctx);
		for (const hook of hooks.onResponse) {
			const replaced = await hook(response, ctx);
			if (replaced instanceof Response) response = replaced;
		}
		return response;
	};
}

/**
 * Create a client from options (or just a base URL).
 *
 * ```ts
 * const api = createClient({ baseUrl: "https://api.example.com", auth: token, errors: { 401: Unauthorized } });
 * const user = await api.get("/users/:id", { params: { id: 1 } }).returns(User);
 * ```
 */
export function createClient(baseUrl?: string): Client;
export function createClient<const O extends ClientOptions>(options: O): Client<ErrorsOf<O>>;
export function createClient(options: string | ClientOptions = {}): Client<any> {
	return new Client(applyOptions(DEFAULT_CONFIG, typeof options === "string" ? { baseUrl: options } : options));
}
