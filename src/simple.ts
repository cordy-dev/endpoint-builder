/**
 * Universal API for endpoint-builder
 * Supports both simple and advanced use cases through a single createClient function
 */

import { ApiKeyStrategy } from "./auth/ApiKeyStrategy";
import type { AuthStrategy } from "./auth/AuthStrategy";
import { HttpClient } from "./core/HttpClient";
import { RequestBuilder } from "./core/RequestBuilder";
import { ExponentialRetryStrategy } from "./retry/ExponentialRetryStrategy";
import type { RetryStrategy } from "./retry/RetryStrategy";
import type { PersistStorage } from "./storage/PersistStorage";
import type { BodyLike, HttpHeaders, HttpMethod, HttpResponse, QueryParams, RequestInterceptor, ResponseInterceptor } from "./types";

export interface UniversalClientOptions {
	/** Base URL for all requests */
	baseUrl?: string;

	// === SIMPLE AUTH OPTIONS ===
	/** Authorization header value (e.g., "Bearer token123" or "token123") */
	auth?: string;
	/** API key for X-API-Key header */
	apiKey?: string;

	// === ADVANCED AUTH OPTIONS ===
	/** Custom authentication strategy */
	authStrategy?: AuthStrategy;
	/** Storage for tokens/auth data */
	storage?: PersistStorage;

	// === REQUEST OPTIONS ===
	/** Default headers for all requests */
	headers?: HttpHeaders;
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;

	// === SIMPLE RETRY OPTIONS ===
	/** Enable automatic retries (default: true) */
	retry?: boolean;

	// === ADVANCED RETRY OPTIONS ===
	/** Custom retry strategy */
	retryStrategy?: RetryStrategy | null;

	// === ADVANCED OPTIONS ===
	/** Enable request deduplication (default: true) */
	dedupe?: boolean;
	/** Default response type */
	responseType?: "json" | "text" | "blob" | "arraybuffer" | "stream";
	/** Request interceptors */
	requestInterceptors?: RequestInterceptor[];
	/** Response interceptors */
	responseInterceptors?: ResponseInterceptor[];
}

/**
 * Universal HTTP client that works for both simple and advanced use cases
 */
export class UniversalClient {
	private client: HttpClient;
	private defaultTimeout: number;

	constructor(options: UniversalClientOptions = {}) {
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
			responseInterceptors
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

		this.client = new HttpClient({
			baseUrl,
			auth: finalAuthStrategy,
			storage,
			defaultHeaders: headers,
			retryStrategy: finalRetryStrategy,
			dedupe,
			responseType,
			requestInterceptors,
			responseInterceptors,
		});

		this.defaultTimeout = timeout;
	}

	// === SIMPLE API METHODS ===

	/**
	 * Make a GET request
	 */
	get<T = unknown>(path: string, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.get<T>(path);

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a POST request with JSON body
	 */
	post<T = unknown, D extends BodyLike = BodyLike>(path: string, data?: D, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.post<T>(path);

		if (data !== undefined) {
			request.json(data as object & BodyLike);
		}

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a PUT request with JSON body
	 */
	put<T = unknown, D extends BodyLike = BodyLike>(path: string, data?: D, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.put<T>(path);

		if (data !== undefined) {
			request.json(data as object & BodyLike);
		}

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a PATCH request with JSON body
	 */
	patch<T = unknown, D extends BodyLike = BodyLike>(path: string, data?: D, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.patch<T>(path);

		if (data !== undefined) {
			request.json(data as object & BodyLike);
		}

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a DELETE request
	 */
	delete<T = unknown>(path: string, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.delete<T>(path);

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a HEAD request
	 */
	head(path: string, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<HttpResponse<void>> {
		const request = this.client.head(path);

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.send();
	}

	/**
	 * Make an OPTIONS request
	 */
	options<T = unknown>(path: string, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const request = this.client.options<T>(path);

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Upload files using FormData
	 */
	upload<T = unknown>(path: string, files: Record<string, File | Blob | string>, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const formData = new FormData();

		for (const [key, value] of Object.entries(files)) {
			if (value instanceof File || value instanceof Blob) {
				formData.append(key, value);
			} else {
				formData.append(key, String(value));
			}
		}

		const request = this.client.post<T>(path).body(formData);

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Download a file as Blob
	 */
	download(path: string, options?: {
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<Blob> {
		const request = this.client.get<Blob>(path).responseType("blob");

		if (options?.query) {
			request.query(options.query);
		}

		if (options?.headers) {
			request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Get the full response (not just data)
	 */
	response<T = unknown>(method: HttpMethod, path: string, options?: {
		data?: BodyLike;
		query?: QueryParams;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<HttpResponse<T>> {
		let request: RequestBuilder<T, BodyLike, Record<string, unknown> | undefined>;

		switch (method) {
			case "GET":
				request = this.client.get<T>(path);
				break;
			case "POST":
				request = this.client.post<T>(path);
				break;
			case "PUT":
				request = this.client.put<T>(path);
				break;
			case "PATCH":
				request = this.client.patch<T>(path);
				break;
			case "DELETE":
				request = this.client.delete<T>(path);
				break;
			case "HEAD":
				request = this.client.head(path) as RequestBuilder<T, BodyLike, Record<string, unknown> | undefined>;
				break;
			case "OPTIONS":
				request = this.client.options<T>(path);
				break;
		}

		if (options?.data !== undefined) {
			request = request.json(options.data as object & BodyLike);
		}

		if (options?.query) {
			request = request.query(options.query);
		}

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.send();
	}

	// === ADVANCED API ACCESS ===

	/**
	 * Get a RequestBuilder for advanced request configuration
	 * This gives you access to the full builder pattern API
	 */
	request<T = unknown>(method: HttpMethod, path: string): RequestBuilder<T, BodyLike, Record<string, unknown> | undefined> {
		switch (method) {
			case "GET":
				return this.client.get<T>(path);
			case "POST":
				return this.client.post<T>(path);
			case "PUT":
				return this.client.put<T>(path);
			case "PATCH":
				return this.client.patch<T>(path);
			case "DELETE":
				return this.client.delete<T>(path);
			case "HEAD":
				return this.client.head(path) as RequestBuilder<T, BodyLike, Record<string, unknown> | undefined>;
			case "OPTIONS":
				return this.client.options<T>(path);
		}
	}

	/**
	 * Access the underlying HttpClient for full control
	 */
	get httpClient(): HttpClient {
		return this.client;
	}

	// === INTERCEPTORS ===

	/**
	 * Add a request interceptor
	 * @param interceptor - Request interceptor to add
	 * @returns Function to remove the interceptor
	 */
	addRequestInterceptor(interceptor: RequestInterceptor): () => void {
		return this.client.addRequestInterceptor(interceptor);
	}

	/**
	 * Add a response interceptor
	 * @param interceptor - Response interceptor to add
	 * @returns Function to remove the interceptor
	 */
	addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
		return this.client.addResponseInterceptor(interceptor);
	}
}

/**
 * Create a universal HTTP client that supports both simple and advanced use cases
 *
 * Simple usage:
 * ```typescript
 * const api = createClient({ baseUrl: "...", apiKey: "..." });
 * const data = await api.get("/users");
 * ```
 *
 * Advanced usage:
 * ```typescript
 * const api = createClient({
 *   baseUrl: "...",
 *   authStrategy: new CustomAuthStrategy(),
 *   retryStrategy: new CustomRetryStrategy()
 * });
 * const response = await api.request("GET", "/users")
 *   .timeout(10000)
 *   .retry(customStrategy)
 *   .send();
 * ```
 */
export function createClient(options?: UniversalClientOptions): UniversalClient {
	return new UniversalClient(options);
}

// Keep the old exports for backward compatibility
export { UniversalClient as SimpleClient };
export type { UniversalClientOptions as SimpleClientOptions };
