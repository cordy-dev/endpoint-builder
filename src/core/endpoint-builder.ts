import { NoRetryStrategy } from "../retry-strategies";
import { RequestCache } from "./request-cache";
import type {
	AuthStrategy,
	ExecutionOptions,
	HttpError,
	HttpHeaders,
	HttpRequestConfig,
	HttpResponse,
	MockResponse,
	ResponseType,
	RetryConfig
} from "./types";

/**
 * Core endpoint builder with native fetch
 */
export class EndpointBuilder {
	private static requestCache = new RequestCache();

	private config: HttpRequestConfig;
	private retryConfig?: RetryConfig;
	private mockResponse?: MockResponse;
	private authStrategy?: AuthStrategy | null; // null means explicitly disabled
	private mockModeEnabled: boolean = false;
	private cacheEnabled: boolean = false;

	constructor(
		url: string,
		method: HttpRequestConfig["method"] = "GET"
	) {
		this.config = {
			url,
			method,
			headers: {}
		};
	}

	/**
	 * Set query parameters
	 */
	params(params: Record<string, any>): this {
		try {
			const url = new URL(this.config.url);
			Object.entries(params).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					url.searchParams.set(key, String(value));
				}
			});
			this.config.url = url.toString();
		} catch {
			// If URL is not absolute, treat as relative and build query string manually
			const queryString = new URLSearchParams();
			Object.entries(params).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					queryString.set(key, String(value));
				}
			});
			const separator = this.config.url.includes("?") ? "&" : "?";
			this.config.url = `${this.config.url}${separator}${queryString.toString()}`;
		}
		return this;
	}

	/**
	 * Set request headers
	 */
	headers(headers: HttpHeaders): this {
		this.config.headers = { ...this.config.headers, ...headers };
		return this;
	}

	/**
	 * Set single header
	 */
	header(name: string, value: string): this {
		this.config.headers = this.config.headers || {};
		this.config.headers[name] = value;
		return this;
	}

	/**
	 * Set JSON body and appropriate headers
	 */
	json(data: any): this {
		this.config.body = JSON.stringify(data);
		return this.header("Content-Type", "application/json");
	}

	/**
	 * Set form data body
	 */
	form(data: FormData | Record<string, any>): this {
		if (data instanceof FormData) {
			this.config.body = data;
		} else {
			const formData = new FormData();
			Object.entries(data).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					formData.append(key, String(value));
				}
			});
			this.config.body = formData;
		}
		return this;
	}

	/**
	 * Set URL-encoded form body
	 */
	urlencoded(data: Record<string, any>): this {
		const params = new URLSearchParams();
		Object.entries(data).forEach(([key, value]) => {
			if (value !== undefined && value !== null) {
				params.append(key, String(value));
			}
		});
		this.config.body = params.toString();
		return this.header("Content-Type", "application/x-www-form-urlencoded");
	}

	/**
	 * Set raw body data
	 */
	body(data: any): this {
		this.config.body = data;
		return this;
	}

	/**
	 * Set timeout for this request
	 */
	timeout(ms: number): this {
		this.config.timeout = ms;
		return this;
	}

	/**
	 * Set response type
	 */
	responseType(type: ResponseType): this {
		this.config.responseType = type;
		return this;
	}

	/**
	 * Configure retry behavior
	 */
	retry(config: RetryConfig): this {
		this.retryConfig = config;
		return this;
	}

	/**
	 * Configure authentication for this request
	 * Pass null to disable authentication for this request
	 */
	auth(strategy: AuthStrategy | null): this {
		this.authStrategy = strategy;
		return this;
	}

	/**
	 * Disable authentication for this request
	 */
	noAuth(): this {
		return this.auth(null);
	}

	/**
	 * Set mock response for this request
	 */
	mock(response: MockResponse): this {
		this.mockResponse = response;
		return this;
	}

	/**
	 * Enable/disable mock-only mode for this request.
	 * When enabled, the request will only use mock responses and throw error if no mock is available
	 */
	mockMode(enabled: boolean = true): this {
		this.mockModeEnabled = enabled;
		return this;
	}

	/**
	 * Enable/disable request caching for this request.
	 * When enabled, identical parallel requests will be cached/deduplicated
	 */
	cache(enabled: boolean = true): this {
		this.cacheEnabled = enabled;
		return this;
	}

	/**
	 * Execute the HTTP request and return only the data
	 */
	async data<T = any>(options: ExecutionOptions = {}): Promise<T> {
		const response = await this.execute<T>(options);
		return response.data;
	}

	/**
	 * Execute the HTTP request
	 */
	async execute<T = any>(options: ExecutionOptions = {}): Promise<HttpResponse<T>> {
		const hasMockResponse = this.mockResponse !== undefined;
		const isMockMode = this.mockModeEnabled || options.mockOnly;

		// In mock-only mode, throw error if no mock response is available
		if (isMockMode && !hasMockResponse) {
			throw new Error("Mock-only mode is enabled but no mock response is configured");
		}

		// Return mock response if available and not explicitly disabled
		if ((options.mock !== false && this.mockResponse) || isMockMode) {
			const mockResponse = this.mockResponse!;

			// Simulate delay if specified
			if (mockResponse.delay && mockResponse.delay > 0) {
				await new Promise(resolve => setTimeout(resolve, mockResponse.delay));
			}

			return {
				data: mockResponse.data,
				status: mockResponse.status || 200,
				statusText: mockResponse.statusText || "OK",
				headers: mockResponse.headers || {},
				config: this.config
			};
		}

		// Skip authentication in mock-only mode
		if (isMockMode) {
			return this.executeRequest<T>(this.config, options);
		}

		// Prepare config for execution
		let requestConfig = { ...this.config };

		// Apply timeout from options if provided
		if (options.timeout) {
			requestConfig.timeout = options.timeout;
		}

		// Apply signal from options if provided
		if (options.signal) {
			requestConfig.signal = options.signal;
		}

		// Apply authentication if configured (unless explicitly disabled)
		if (this.authStrategy !== null) {
			const authStrategy = this.authStrategy;
			if (authStrategy) {
				requestConfig = await authStrategy.applyAuth(requestConfig);
			}
		}

		// Check if request should be cached/deduplicated
		const shouldCache = this.cacheEnabled || options.cache;

		if (shouldCache) {
			return EndpointBuilder.requestCache.get(requestConfig, () => {
				return this.executeRequest<T>(requestConfig, options);
			});
		}

		return this.executeRequest<T>(requestConfig, options);
	}

	/**
	 * Execute the actual HTTP request with retry logic
	 */
	private async executeRequest<T>(
		config: HttpRequestConfig,
		options: ExecutionOptions
	): Promise<HttpResponse<T>> {
		// Apply delay if specified
		if (options.delay && options.delay > 0) {
			await new Promise(resolve => setTimeout(resolve, options.delay));
		}

		const retryStrategy = this.retryConfig?.strategy || new NoRetryStrategy();

		let lastError: HttpError | undefined;
		let attempt = 0;
		const maxAttempts = this.retryConfig?.attempts || 1;

		while (attempt < maxAttempts) {
			try {
				return await this.makeRequest<T>(config);
			} catch (error) {
				lastError = error as HttpError;
				attempt++;

				// Don't retry on the last attempt
				if (attempt >= maxAttempts) {
					break;
				}

				// Check if error is retryable
				if (!this.isRetryableError(lastError)) {
					break;
				}

				// Calculate delay using strategy
				const delay = retryStrategy.calculateDelay(attempt, lastError);
				if (delay && delay > 0) {
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		throw lastError || new Error("Request failed after all retry attempts");
	}

	/**
	 * Make the actual fetch request
	 */
	private async makeRequest<T>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
		const response = await fetch(config.url, {
			method: config.method,
			headers: config.headers as HeadersInit,
			body: config.body,
			signal: config.signal
		});

		const data = await this.parseResponse<T>(response);

		const result: HttpResponse<T> = {
			data,
			status: response.status,
			statusText: response.statusText,
			headers: this.getResponseHeaders(response),
			config
		};

		if (!response.ok) {
			const error = new Error(`HTTP Error: ${response.status} ${response.statusText}`) as HttpError;
			error.status = response.status;
			error.statusText = response.statusText;
			error.config = config;
			error.response = result;
			throw error;
		}

		return result;
	}

	/**
	 * Convert Response headers to plain object
	 */
	private getResponseHeaders(response: Response): Record<string, string> {
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key] = value;
		});
		return headers;
	}

	/**
	 * Parse response based on content type
	 */
	private async parseResponse<T>(response: Response): Promise<T> {
		const contentType = response.headers.get("content-type") || "";

		if (contentType.includes("application/json")) {
			return response.json();
		}

		if (contentType.includes("text/")) {
			return response.text() as T;
		}

		// For other types, return as blob or handle accordingly
		if (contentType.includes("application/octet-stream") || contentType.includes("image/")) {
			return response.blob() as T;
		}

		// Default to text
		return response.text() as T;
	}

	/**
	 * Default retry logic for common HTTP errors
	 */
	private isRetryableError(error: HttpError): boolean {
		if (!error.status) return true; // Network errors are retryable
		return error.status >= 500 || error.status === 429; // Server errors and rate limiting
	}

	/**
	 * Static method to get cache size
	 */
	static getCacheSize(): number {
		return EndpointBuilder.requestCache.size();
	}

	/**
	 * Static method to clear cache
	 */
	static clearCache(): void {
		EndpointBuilder.requestCache.clear();
	}
}
