import type { AuthStrategy } from "../auth/AuthStrategy";
import { JitteredExponentialBackoffRetryStrategy } from "../retry/JitteredExponentialBackoffRetryStrategy";
import type { RetryContext, RetryStrategy } from "../retry/RetryStrategy";
import { LocalStoragePersist } from "../storage/LocalStoragePersist";
import type { PersistStorage } from "../storage/PersistStorage";
import type { HttpError, HttpHeaders, HttpRequestConfig, HttpResponse, ResponseType } from "../types";
import { decodeResponse } from "../utils/decodeResponse";
import { mergeHeaders } from "../utils/mergeHeaders";
import { serializeBody } from "../utils/serializeBody";
import { toQuery } from "../utils/toQuery";
import { RequestBuilder } from "./RequestBuilder";

export type Method   = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type BodyLike = BodyInit | Record<string, unknown> | null | undefined;


export interface HttpClientOptions {
  baseUrl?: string;
  auth?: AuthStrategy | null;
  storage?: PersistStorage;
  defaultHeaders?: HttpHeaders;
  dedupe?: boolean;
  responseType?: ResponseType;
  retryStrategy?: RetryStrategy | null;
}

export class HttpClient {
	readonly defaults: Required<HttpClientOptions>;
	private readonly inflight = new Map<string, Promise<unknown>>();

	constructor(opts: HttpClientOptions = {}) {
		this.defaults = {
			baseUrl: "",
			auth: null,
			storage: opts.storage ?? new LocalStoragePersist(),
			dedupe: false,
			defaultHeaders: {},
			responseType: undefined,
			retryStrategy: new JitteredExponentialBackoffRetryStrategy(),
			...opts,
		} as Required<HttpClientOptions>;
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
				const config = await this._buildConfig(rb);

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
					if ((err as any).name === "AbortError") throw err;
				} finally {
					clearTimeout(timeoutId);
				}

				// Handle token refresh if authentication fails
				if (response &&
				    this.defaults.auth?.refresh &&
				    await this.defaults.auth.refresh(new Request(config.url), response)) {
					continue; // retry immediately, don't count as retry attempt
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
					const error = new Error(`HTTP ${(response && response.status) || "fetch"}`) as HttpError;
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

					throw error;
				}

				// Process successful response
				const data = await decodeResponse<T>(response, config);
				return {
					data,
					status: response.status,
					statusText: response.statusText,
					headers: this._respHeaders(response),
					config
				};
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
		// Если путь пустой, возвращаем базовый URL
		if (!path) {
			return new URL(baseUrl);
		}

		// Если путь начинается с протокола (полный URL), используем его как есть
		if (path.match(/^https?:\/\//)) {
			return new URL(path);
		}

		// Нормализуем baseUrl - убираем завершающий слеш
		const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

		// Нормализуем путь - убираем начальный слеш для правильного объединения
		const normalizedPath = path.replace(/^\//, "");

		// Объединяем с помощью слеша
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
			const authHeaders = await auth.enrich(new Request(url.toString()));
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