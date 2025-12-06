import type { AuthStrategy } from "../auth/AuthStrategy";
import { ExponentialRetryStrategy } from "../retry/ExponentialRetryStrategy";
import type { RetryContext, RetryStrategy } from "../retry/RetryStrategy";
import { LocalStoragePersist } from "../storage/LocalStoragePersist";
import { MemoryStoragePersist } from "../storage/MemoryStoragePersist";
import type { PersistStorage } from "../storage/PersistStorage";
import type { BodyLike, HttpError, HttpHeaders, HttpRequestConfig, HttpResponse, RequestInterceptor, ResponseInterceptor, ResponseType } from "../types";
import { decodeResponse } from "../utils/decodeResponse";
import { mergeHeaders } from "../utils/mergeHeaders";
import { serializeBody } from "../utils/serializeBody";
import { toQuery } from "../utils/toQuery";
import { RequestBuilder } from "./RequestBuilder";

// Pre-compiled regex for better performance
const HTTP_URL_REGEX = /^https?:\/\//;


export interface HttpClientOptions {
  baseUrl?: string;
  auth?: AuthStrategy | null;
  storage?: PersistStorage;
  defaultHeaders?: HttpHeaders;
  dedupe?: boolean;
  responseType?: ResponseType;
  retryStrategy?: RetryStrategy | null;
  /** Request interceptors - called before each request */
  requestInterceptors?: RequestInterceptor[];
  /** Response interceptors - called after each response */
  responseInterceptors?: ResponseInterceptor[];
}

/**
 * Auto-detect the best storage for the current environment
 */
function createDefaultStorage(): PersistStorage {
	if (typeof localStorage !== "undefined") {
		return new LocalStoragePersist();
	}
	return new MemoryStoragePersist();
}

export class HttpClient {
	readonly defaults: Required<HttpClientOptions>;
	private readonly inflight = new Map<string, Promise<unknown>>();
	private readonly requestInterceptors: RequestInterceptor[];
	private readonly responseInterceptors: ResponseInterceptor[];

	constructor(opts: HttpClientOptions = {}) {
		this.requestInterceptors = opts.requestInterceptors ?? [];
		this.responseInterceptors = opts.responseInterceptors ?? [];

		this.defaults = {
			baseUrl: "",
			auth: null,
			storage: opts.storage ?? createDefaultStorage(),
			dedupe: false,
			defaultHeaders: {},
			responseType: undefined,
			retryStrategy: new ExponentialRetryStrategy(),
			requestInterceptors: this.requestInterceptors,
			responseInterceptors: this.responseInterceptors,
			...opts,
		} as Required<HttpClientOptions>;
	}

	/**
	 * Add a request interceptor
	 * @param interceptor - Request interceptor to add
	 * @returns Function to remove the interceptor
	 */
	addRequestInterceptor(interceptor: RequestInterceptor): () => void {
		this.requestInterceptors.push(interceptor);
		return () => {
			const index = this.requestInterceptors.indexOf(interceptor);
			if (index !== -1) {
				this.requestInterceptors.splice(index, 1);
			}
		};
	}

	/**
	 * Add a response interceptor
	 * @param interceptor - Response interceptor to add
	 * @returns Function to remove the interceptor
	 */
	addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
		this.responseInterceptors.push(interceptor);
		return () => {
			const index = this.responseInterceptors.indexOf(interceptor);
			if (index !== -1) {
				this.responseInterceptors.splice(index, 1);
			}
		};
	}

	/**
	 * Creates a GET request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template Q - Query parameters type
	 */
	get<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, undefined, Q>(this, path).method("GET");
	}

	/**
	 * Creates a POST request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template B - Request body type
	 * @template Q - Query parameters type
	 */
	post<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("POST");
	}

	/**
	 * Creates a PUT request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template B - Request body type
	 * @template Q - Query parameters type
	 */
	put<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("PUT");
	}

	/**
	 * Creates a PATCH request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template B - Request body type
	 * @template Q - Query parameters type
	 */
	patch<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("PATCH");
	}

	/**
	 * Creates a DELETE request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template Q - Query parameters type
	 */
	delete<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, undefined, Q>(this, path).method("DELETE");
	}

	/**
	 * Creates a HEAD request builder
	 * @param path - Request path
	 * @template Q - Query parameters type
	 */
	head<Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<void, undefined, Q>(this, path).method("HEAD");
	}

	/**
	 * Creates an OPTIONS request builder
	 * @param path - Request path
	 * @template T - Expected response type
	 * @template Q - Query parameters type
	 */
	options<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, undefined, Q>(this, path).method("OPTIONS");
	}

	/**
	 * Execute a request with retry, deduplication, and authentication handling
	 * @param rb - Request builder to execute
	 * @returns Promise resolving to HTTP response
	 */
	async _execute<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): Promise<HttpResponse<T>> {
		// Handle deduplication of in-flight requests
		const dedupe = rb._dedupe ?? this.defaults.dedupe;
		const key = dedupe ? this._dedupeKey(rb) : undefined;
		if (key && this.inflight.has(key)) {
			return this.inflight.get(key) as Promise<HttpResponse<T>>;
		}

		// Define the request execution function
		const executeRequest = async (): Promise<HttpResponse<T>> => {
			let attempt = 0;

			while (true) {
				attempt++;
				let config = await this._buildConfig(rb);

				// Apply request interceptors
				for (const interceptor of this.requestInterceptors) {
					config = await interceptor.onRequest(config);
				}

				// Setup abort controller and timeout
				const controller = config.signal ? undefined : new AbortController();
				const timeoutId = config.timeout && controller ?
					setTimeout(() => controller.abort("timeout"), config.timeout) : undefined;
				const signal = config.signal ?? controller?.signal;

				// Execute the fetch request
				let response: Response | undefined;
				try {
					response = await fetch(config.url, {
						method: config.method,
						headers: config.headers as HeadersInit,
						body: serializeBody(config.body, config.headers ?? {}),
						signal,
					});
				} catch (err) {
					// Rethrow abort errors, they are intentional
					if ((err as Error).name === "AbortError") throw err;
				} finally {
					clearTimeout(timeoutId);
				}

				// Handle token refresh if authentication fails
				if (response && this.defaults.auth?.handleRequestError) {
					if (await this.defaults.auth.handleRequestError(new Request(config.url), response)) {
						continue; // retry immediately, don't count as retry attempt
					}
				}

				// Handle retry logic for error responses
				if (response && !response.ok) {
					const retryContext: RetryContext = {
						attempt,
						response,
						config
					};

					const retryStrategy = rb._retry ?? this.defaults.retryStrategy;
					const shouldRetry = retryStrategy?.shouldRetry(retryContext) ?? false;

					if (shouldRetry) {
						const delay = await retryStrategy!.nextDelay(retryContext);
						await new Promise(resolve => setTimeout(resolve, delay));
						continue;
					}
				}

				// Handle error responses
				if (!response || !response.ok) {
					let error = new Error(`HTTP ${(response && response.status) || "fetch"}`) as HttpError;
					error.config = config;

					if (response) {
						error.status = response.status;
						error.statusText = response.statusText;
						error.response = {
							data: undefined,
							status: response.status,
							statusText: response.statusText,
							headers: this._respHeaders(response),
							config,
						};
					}

					// Apply error interceptors
					for (const interceptor of this.responseInterceptors) {
						if (interceptor.onError) {
							error = await interceptor.onError(error);
						}
					}

					throw error;
				}

				// Process successful response
				const data = await decodeResponse<T>(response, config);
				let result: HttpResponse<T> = {
					data,
					status: response.status,
					statusText: response.statusText,
					headers: this._respHeaders(response),
					config
				};

				// Apply response interceptors
				for (const interceptor of this.responseInterceptors) {
					result = await interceptor.onResponse(result);
				}

				return result;
			}
		};

		// Execute the request and clean up deduplication map when done
		const promise = executeRequest().finally(() => {
			if (key) {
				this.inflight.delete(key);
			}
		});

		if (key) {
			this.inflight.set(key, promise);
		}

		return promise;
	}

	/**
	 * Convert fetch Response headers to HttpHeaders object
	 * @param response - Fetch Response object
	 * @returns Headers as plain object
	 */
	private _respHeaders(response: Response): HttpHeaders {
		const headers: HttpHeaders = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});
		return headers;
	}

	/* ---------------- helpers ------------------- */
	private _dedupeKey<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): string {
		// Use a more efficient serialization for deduplication
		const parts = [
			rb._method,
			rb.input,
			rb._query ? JSON.stringify(rb._query) : "",
			typeof rb._body === "object" && rb._body !== null ? JSON.stringify(rb._body) : String(rb._body ?? "")
		];
		return parts.join("|");
	}

	private resolveUrl(baseUrl: string, path: string): URL {
		// If path is empty, return base URL
		if (!path) {
			return new URL(baseUrl);
		}

		// If path starts with protocol (full URL), use it as is
		if (HTTP_URL_REGEX.test(path)) {
			return new URL(path);
		}

		// Normalize baseUrl - remove trailing slash
		const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

		// Normalize path - remove leading slash for proper joining
		const normalizedPath = path.replace(/^\//, "");

		// Join with slash
		const fullUrl = `${normalizedBaseUrl}/${normalizedPath}`;

		return new URL(fullUrl);
	}

	private async _buildConfig<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): Promise<HttpRequestConfig> {
		// Build URL with query parameters
		const baseUrl = this.defaults.baseUrl || "http://localhost";
		const url = this.resolveUrl(baseUrl, rb.input);
		if (rb._query) {
			url.search = toQuery(rb._query);
		}

		// Merge headers efficiently - start with defaults, add request-specific, then auth
		let headers: HttpHeaders = { ...this.defaults.defaultHeaders };
		if (Object.keys(rb._headers).length > 0) {
			headers = mergeHeaders(headers, rb._headers);
		}

		// Add authentication headers if available
		const auth = rb._auth ?? this.defaults.auth;
		if (auth) {
			// Use new method name, fallback to deprecated one for backward compatibility
			const authHeaders = await auth.enrichRequest(new Request(url.toString()));
			if (Object.keys(authHeaders).length > 0) {
				headers = mergeHeaders(headers, authHeaders);
			}
		}

		return {
			url: url.toString(),
			method: rb._method,
			headers,
			body: rb._body,
			responseType: rb._responseType ?? this.defaults.responseType,
		};
	}

	/**
	 * Clone the HttpClient with updated options
	 * @param patch - Options to override
	 * @returns New HttpClient instance
	 */
	_clone(patch: Partial<HttpClientOptions>): HttpClient {
		return new HttpClient({ ...this.defaults, ...patch });
	}

	/**
	 * Wrap a RequestBuilder instance with this HttpClient
	 * @param builder - RequestBuilder to wrap
	 * @returns New RequestBuilder instance
	 */
	_wrap<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(builder: RequestBuilder<T, B, Q>): RequestBuilder<T, B, Q> {
		const rb = new RequestBuilder<T, B, Q>(this, builder.input);

		// Copy all properties from the original builder
		rb._method = builder._method;
		rb._body = builder._body;
		rb._headers = { ...builder._headers };
		rb._dedupe = builder._dedupe;
		rb._query = builder._query;
		rb._responseType = builder._responseType;
		rb._timeout = builder._timeout;
		rb._signal = builder._signal;
		rb._retry = builder._retry;
		rb._auth = builder._auth;

		return rb;
	}
}