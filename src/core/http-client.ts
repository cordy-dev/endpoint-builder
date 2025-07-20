import { EndpointBuilder } from "./endpoint-builder";
import type { AuthStrategy, HttpClientOptions, HttpRequestConfig} from "./types";

/**
 * HTTP client with native fetch
 */
export class HttpClient {
	private baseUrl: string;
	private defaultAuthStrategy?: AuthStrategy | null;
	private options?: HttpClientOptions;

	constructor(
		baseUrl: string,
		authStrategy?: AuthStrategy | null,
		options?: HttpClientOptions
	) {
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
		this.defaultAuthStrategy = authStrategy;
		this.options = options;
	}

	/**
	 * Create GET request builder
	 */
	get(path: string): EndpointBuilder {
		return this.createBuilder(path, "GET");
	}

	/**
	 * Create POST request builder
	 */
	post(path: string): EndpointBuilder {
		return this.createBuilder(path, "POST");
	}

	/**
	 * Create PUT request builder
	 */
	put(path: string): EndpointBuilder {
		return this.createBuilder(path, "PUT");
	}

	/**
	 * Create PATCH request builder
	 */
	patch(path: string): EndpointBuilder {
		return this.createBuilder(path, "PATCH");
	}

	/**
	 * Create DELETE request builder
	 */
	delete(path: string): EndpointBuilder {
		return this.createBuilder(path, "DELETE");
	}

	/**
	 * Create HEAD request builder
	 */
	head(path: string): EndpointBuilder {
		return this.createBuilder(path, "HEAD");
	}

	/**
	 * Create OPTIONS request builder
	 */
	requestOptions(path: string): EndpointBuilder {
		return this.createBuilder(path, "OPTIONS");
	}

	/**
	 * Create a new HttpClient with mock mode enabled/disabled
	 */
	withMock(enabled: boolean): HttpClient {
		const newOptions = { ...this.options, mockOnly: enabled };
		return new HttpClient(this.baseUrl, this.defaultAuthStrategy, newOptions);
	}

	/**
	 * Create a new HttpClient with cache enabled/disabled
	 */
	withCache(enabled: boolean): HttpClient {
		const newOptions = { ...this.options, cache: enabled };
		return new HttpClient(this.baseUrl, this.defaultAuthStrategy, newOptions);
	}

	/**
	 * Create a new HttpClient with different auth strategy
	 */
	withAuth(authStrategy: AuthStrategy | null): HttpClient {
		return new HttpClient(this.baseUrl, authStrategy, this.options);
	}

	/**
	 * Create endpoint builder with proper URL resolution
	 */
	private createBuilder(path: string, method: HttpRequestConfig["method"]): EndpointBuilder {
		const url = this.resolveUrl(path);
		const builder = new EndpointBuilder(url, method);

		// Apply default auth strategy if not explicitly disabled
		if (this.defaultAuthStrategy) {
			builder.auth(this.defaultAuthStrategy);
		}

		// Apply mock mode if enabled
		if (this.options?.mockOnly) {
			builder.mockMode(true);
		}

		// Apply cache if enabled
		if (this.options?.cache) {
			builder.cache(true);
		}

		return builder;
	}

	/**
	 * Resolve relative path against base URL
	 */
	private resolveUrl(path: string): string {
		if (path.startsWith("http://") || path.startsWith("https://")) {
			return path; // Absolute URL
		}

		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		return `${this.baseUrl}${normalizedPath}`;
	}
}
