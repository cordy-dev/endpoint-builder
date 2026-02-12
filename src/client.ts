/**
 * New typed API client with path parameter extraction and schema validation
 */

import { ApiKeyStrategy } from "./auth/ApiKeyStrategy";
import type { AuthStrategy } from "./auth/AuthStrategy";
import { HttpClient } from "./core/HttpClient";
import type { RequestBuilder } from "./core/RequestBuilder";
import { ExponentialRetryStrategy } from "./retry/ExponentialRetryStrategy";
import type { RetryStrategy } from "./retry/RetryStrategy";
import type { PersistStorage } from "./storage/PersistStorage";
import type { ExtractPathParams, HasPathParams } from "./types/path-params";
import { buildPath } from "./types/path-params";
import type { BodyLike, HttpHeaders, QueryParams, RequestInterceptor, ResponseInterceptor, ResponseType } from "./types";

/**
 * Options for creating a typed client
 */
export interface TypedClientOptions {
	/** Base URL for all requests */
	baseUrl?: string;

	/** Default headers for all requests */
	headers?: HttpHeaders;

	/** Request timeout in milliseconds */
	timeout?: number;

	/** Enable request deduplication */
	dedupe?: boolean;

	/** Default response type */
	responseType?: ResponseType;

	// === AUTH OPTIONS ===
	/** Simple auth: Bearer token string */
	auth?: string;
	/** Simple auth: API key */
	apiKey?: string;
	/** Advanced auth: Custom strategy */
	authStrategy?: AuthStrategy;

	// === RETRY OPTIONS ===
	/** Enable automatic retries */
	retry?: boolean;
	/** Custom retry strategy */
	retryStrategy?: RetryStrategy | null;

	// === ADVANCED OPTIONS ===
	/** Storage for auth tokens */
	storage?: PersistStorage;
	/** Request interceptors */
	requestInterceptors?: RequestInterceptor[];
	/** Response interceptors */
	responseInterceptors?: ResponseInterceptor[];
	/** Global response unwrap function */
	unwrap?: (response: unknown) => unknown;
}

/**
 * Request options for methods with path parameters
 */
export type TypedRequestOptions<TPath extends string, TBody = unknown> =
	(HasPathParams<TPath> extends true
		? { params: ExtractPathParams<TPath> }
		: { params?: never }
	) & {
		query?: QueryParams;
		body?: TBody;
		headers?: HttpHeaders;
		timeout?: number;
	};

/**
 * Typed HTTP client with path parameter extraction and schema validation
 */
export class TypedClient {
	private readonly httpClient: HttpClient;
	private readonly defaultTimeout: number;

	constructor(options: TypedClientOptions = {}) {
		const {
			baseUrl = "",
			auth,
			apiKey,
			authStrategy,
			storage,
			headers = {},
			retry = true,
			retryStrategy,
			timeout = 30000,
			dedupe = true,
			responseType,
			requestInterceptors,
			responseInterceptors,
			unwrap,
		} = options;

		// Determine auth strategy with priority: authStrategy > apiKey > auth
		let finalAuthStrategy: AuthStrategy | null = null;

		if (authStrategy) {
			finalAuthStrategy = authStrategy;
		} else if (apiKey) {
			finalAuthStrategy = new ApiKeyStrategy("X-API-Key", apiKey);
		} else if (auth) {
			const authValue = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
			finalAuthStrategy = new ApiKeyStrategy("Authorization", authValue);
		}

		// Determine retry strategy
		let finalRetryStrategy: RetryStrategy | null = null;
		if (retryStrategy !== undefined) {
			finalRetryStrategy = retryStrategy;
		} else if (retry) {
			finalRetryStrategy = new ExponentialRetryStrategy();
		}

		this.httpClient = new HttpClient({
			baseUrl,
			auth: finalAuthStrategy,
			storage,
			defaultHeaders: headers,
			retryStrategy: finalRetryStrategy,
			dedupe,
			responseType,
			requestInterceptors,
			responseInterceptors,
			unwrap,
		});

		this.defaultTimeout = timeout;
	}

	private applyOptions(builder: RequestBuilder<any, any, any>, options?: { query?: QueryParams; headers?: HttpHeaders; timeout?: number }): void {
		if (options?.query) {
			builder.query(options.query as Record<string, unknown>);
		}
		if (options?.headers) {
			builder.headers(options.headers);
		}
		builder.timeout(options?.timeout ?? this.defaultTimeout);
	}

	/**
	 * Make a GET request
	 * @returns RequestBuilder for chaining .schema(), .safe(), .data(), etc.
	 */
	get<TPath extends string>(
		path: TPath,
		options?: TypedRequestOptions<TPath>
	): RequestBuilder<unknown, undefined, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.get(resolvedPath);
		this.applyOptions(builder, options);
		return builder;
	}

	/**
	 * Make a POST request
	 * @returns RequestBuilder for chaining .schema(), .safe(), .data(), etc.
	 */
	post<TPath extends string, TBody extends BodyLike = BodyLike>(
		path: TPath,
		options?: TypedRequestOptions<TPath, TBody>
	): RequestBuilder<unknown, TBody, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.post<unknown, TBody>(resolvedPath);
		if (options?.body !== undefined) {
			builder.json(options.body as object & BodyLike);
		}
		this.applyOptions(builder, options);
		return builder as RequestBuilder<unknown, TBody, Record<string, unknown> | undefined>;
	}

	/**
	 * Make a PUT request
	 * @returns RequestBuilder for chaining .schema(), .safe(), .data(), etc.
	 */
	put<TPath extends string, TBody extends BodyLike = BodyLike>(
		path: TPath,
		options?: TypedRequestOptions<TPath, TBody>
	): RequestBuilder<unknown, TBody, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.put<unknown, TBody>(resolvedPath);
		if (options?.body !== undefined) {
			builder.json(options.body as object & BodyLike);
		}
		this.applyOptions(builder, options);
		return builder as RequestBuilder<unknown, TBody, Record<string, unknown> | undefined>;
	}

	/**
	 * Make a PATCH request
	 * @returns RequestBuilder for chaining .schema(), .safe(), .data(), etc.
	 */
	patch<TPath extends string, TBody extends BodyLike = BodyLike>(
		path: TPath,
		options?: TypedRequestOptions<TPath, TBody>
	): RequestBuilder<unknown, TBody, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.patch<unknown, TBody>(resolvedPath);
		if (options?.body !== undefined) {
			builder.json(options.body as object & BodyLike);
		}
		this.applyOptions(builder, options);
		return builder as RequestBuilder<unknown, TBody, Record<string, unknown> | undefined>;
	}

	/**
	 * Make a DELETE request
	 * @returns RequestBuilder for chaining .schema(), .safe(), .data(), etc.
	 */
	delete<TPath extends string>(
		path: TPath,
		options?: TypedRequestOptions<TPath>
	): RequestBuilder<unknown, undefined, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.delete(resolvedPath);
		this.applyOptions(builder, options);
		return builder;
	}

	/**
	 * Make a HEAD request
	 * @returns RequestBuilder for chaining
	 */
	head<TPath extends string>(
		path: TPath,
		options?: TypedRequestOptions<TPath>
	): RequestBuilder<void, undefined, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.head(resolvedPath);
		this.applyOptions(builder, options);
		return builder;
	}

	/**
	 * Make an OPTIONS request
	 * @returns RequestBuilder for chaining
	 */
	options<TPath extends string>(
		path: TPath,
		options?: TypedRequestOptions<TPath>
	): RequestBuilder<unknown, undefined, Record<string, unknown> | undefined> {
		const resolvedPath = options?.params
			? buildPath(path, options.params as ExtractPathParams<TPath>)
			: path;

		const builder = this.httpClient.options(resolvedPath);
		this.applyOptions(builder, options);
		return builder;
	}

	/**
	 * Access the underlying HttpClient for advanced usage
	 */
	get httpClientInstance(): HttpClient {
		return this.httpClient;
	}

	/**
	 * Add a request interceptor
	 * @returns Function to remove the interceptor
	 */
	addRequestInterceptor(interceptor: RequestInterceptor): () => void {
		return this.httpClient.addRequestInterceptor(interceptor);
	}

	/**
	 * Add a response interceptor
	 * @returns Function to remove the interceptor
	 */
	addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
		return this.httpClient.addResponseInterceptor(interceptor);
	}
}

/**
 * Create a typed HTTP client with path parameter extraction and schema validation
 *
 * @example
 * ```typescript
 * const api = createClient({ baseUrl: "https://api.example.com" });
 *
 * // With path parameters (type-safe)
 * const user = await api
 *   .get("/users/:id", { params: { id: 1 } })
 *   .schema(UserSchema);
 *
 * // With safe mode (returns Result)
 * const result = await api
 *   .get("/users/:id", { params: { id: 1 } })
 *   .schema(UserSchema)
 *   .safe();
 *
 * if (result.error) {
 *   console.error(result.error);
 * } else {
 *   console.log(result.data);
 * }
 * ```
 */
export function createClient(options?: TypedClientOptions): TypedClient {
	return new TypedClient(options);
}

// Re-export for convenience
export type { AuthStrategy } from "./auth/AuthStrategy";
export type { RetryStrategy } from "./retry/RetryStrategy";
