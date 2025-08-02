/**
 * Universal API for endpoint-builder
 * Supports both simple and advanced use cases through a single createClient function
 */

import { ApiKeyStrategy } from "./auth/ApiKeyStrategy";
import type { AuthStrategy } from "./auth/AuthStrategy";
import { OpaqueTokenStrategy } from "./auth/OpaqueTokenStrategy";
import { HttpClient } from "./core/HttpClient";
import type { RequestBuilder } from "./core/RequestBuilder";
import { ExponentialRetryStrategy } from "./retry/ExponentialRetryStrategy";
import type { RetryStrategy } from "./retry/RetryStrategy";
import type { PersistStorage } from "./storage/PersistStorage";
import type { HttpHeaders, HttpResponse } from "./types";

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
			responseType
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

		// Handle storage for OpaqueTokenStrategy
		if (finalAuthStrategy instanceof OpaqueTokenStrategy && storage) {
			// Storage is already configured in the strategy
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
		});

		this.defaultTimeout = timeout;
	}

	// === SIMPLE API METHODS ===

	/**
	 * Make a GET request
	 */
	get<T = any>(path: string, options?: {
		query?: Record<string, any>;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		let request = this.client.get<T>(path) as any;

		if (options?.query) {
			request = request.query(options.query);
		}

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a POST request with JSON body
	 */
	post<T = any>(path: string, data?: any, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		let request = this.client.post<T>(path) as any;

		if (data !== undefined) {
			request = request.json(data);
		}

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a PUT request with JSON body
	 */
	put<T = any>(path: string, data?: any, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		let request = this.client.put<T>(path) as any;

		if (data !== undefined) {
			request = request.json(data);
		}

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a PATCH request with JSON body
	 */
	patch<T = any>(path: string, data?: any, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		let request = this.client.patch<T>(path) as any;

		if (data !== undefined) {
			request = request.json(data);
		}

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Make a DELETE request
	 */
	delete<T = any>(path: string, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		let request = this.client.delete<T>(path) as any;

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Upload files using FormData
	 */
	upload<T = any>(path: string, files: Record<string, File | string>, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<T> {
		const formData = new FormData();

		for (const [key, value] of Object.entries(files)) {
			if (value instanceof File) {
				formData.append(key, value);
			} else {
				formData.append(key, String(value));
			}
		}

		let request = this.client.post<T>(path).body(formData) as any;

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Download a file as Blob
	 */
	download(path: string, options?: {
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<Blob> {
		let request = this.client.get(path).responseType("blob") as any;

		if (options?.headers) {
			request = request.headers(options.headers);
		}

		if (options?.timeout || this.defaultTimeout) {
			request = request.timeout(options?.timeout ?? this.defaultTimeout);
		}

		return request.data();
	}

	/**
	 * Get the full response (not just data)
	 */
	response<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, options?: {
		data?: any;
		query?: Record<string, any>;
		headers?: HttpHeaders;
		timeout?: number;
	}): Promise<HttpResponse<T>> {
		let request: any;

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
		}

		if (options?.data !== undefined) {
			request = request.json(options.data);
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
	request<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string): RequestBuilder<T, any, any> {
		switch (method) {
			case "GET":
				return this.client.get<T>(path) as any;
			case "POST":
				return this.client.post<T>(path) as any;
			case "PUT":
				return this.client.put<T>(path) as any;
			case "PATCH":
				return this.client.patch<T>(path) as any;
			case "DELETE":
				return this.client.delete<T>(path) as any;
		}
	}

	/**
	 * Access the underlying HttpClient for full control
	 */
	get httpClient(): HttpClient {
		return this.client;
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
