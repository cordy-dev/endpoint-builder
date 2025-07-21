import type { AuthStrategy } from "../auth";
import type { RetryStrategy } from "../retry/RetryStrategy";
import type { HttpHeaders, HttpMethod, HttpResponse, ResponseType } from "../types";
import { mergeHeaders } from "../utils/mergeHeaders";
import type { BodyLike, HttpClient } from "./HttpClient";

export interface RequestOptions<TBody = BodyLike, TQuery extends Record<string, unknown> | undefined = undefined> {
	body?: TBody;
	query?: TQuery;
	headers?: HeadersInit;
	dedupe?: boolean;
	auth?: AuthStrategy | null;
}

export class RequestBuilder<
	TResp = any,
	TBody extends BodyLike = BodyLike,
	TQuery extends Record<string, unknown> | undefined = undefined,
> {
	/* internal */ _method: HttpMethod = "GET";
	/* internal */ _body?: TBody;
	/* internal */ _headers: HttpHeaders = {};
	/* internal */ _dedupe = true;
	/* internal */ _query?: TQuery;
	/* internal */ _responseType?: ResponseType;
	/* internal */ _timeout?: number;
	/* internal */ _signal?: AbortSignal;
	/* internal */ _retry?: RetryStrategy | null;
	/* internal */ _auth?: AuthStrategy | null;

	constructor(private readonly client: HttpClient, readonly input: string) {
		this._dedupe = client.defaults.dedupe;
	}

	/**
	 * Set HTTP method for this request
	 * @param method - HTTP method to use
	 * @returns RequestBuilder instance for chaining
	 */
	method<M extends HttpMethod>(method: M): this {
		this._method = method;
		return this;
	}

	/**
	 * Set query parameters for this request
	 * @param params - Query parameters object
	 * @returns RequestBuilder instance with updated query type
	 */
	query<Q extends Record<string, unknown>>(params: Q): RequestBuilder<TResp, TBody, Q> {
		this._query = params as unknown as TQuery;
		return this as unknown as RequestBuilder<TResp, TBody, Q>;
	}

	/**
	 * Set multiple headers for this request
	 * @param headerMap - Object containing header key-value pairs
	 * @returns RequestBuilder instance for chaining
	 */
	headers(headerMap: HttpHeaders): this {
		this._headers = mergeHeaders(this._headers, headerMap);
		return this;
	}

	/**
	 * Set a single header for the request
	 * @param name - Header name
	 * @param value - Header value
	 * @returns RequestBuilder instance for chaining
	 */
	header(name: string, value: string): this {
		this._headers[name] = value;
		return this;
	}

	/**
	 * Set expected response type for this request
	 * @param responseType - Expected response type
	 * @returns RequestBuilder instance for chaining
	 */
	responseType<R extends ResponseType>(responseType: R): this {
		this._responseType = responseType;
		return this;
	}

	/**
	 * Set request body
	 * @param data - Request body data
	 * @returns RequestBuilder instance with updated body type
	 */
	body<B extends BodyLike>(data: B): RequestBuilder<TResp, B, TQuery> {
		this._body = data as unknown as TBody;
		return this as unknown as RequestBuilder<TResp, B, TQuery>;
	}

	/**
	 * Set request body as JSON with appropriate Content-Type header
	 * @param data - Object to serialize as JSON
	 * @returns RequestBuilder instance with updated body type
	 */
	json<B extends object & BodyLike>(data: B): RequestBuilder<TResp, B, TQuery> {
		this._body = data as unknown as TBody;
		this.headers({ "Content-Type": "application/json" });
		return this as unknown as RequestBuilder<TResp, B, TQuery>;
	}

	/**
	 * Set the request body to FormData or URL-encoded form
	 * @param data - FormData instance or object to convert to FormData
	 * @param urlencoded - Whether to use URL-encoded content type (default: true)
	 * @returns RequestBuilder instance for chaining
	 */
	form(data: FormData | Record<string, any>, urlencoded = true): this {
		this.header("Content-Type", urlencoded ? "application/x-www-form-urlencoded" : "multipart/form-data");

		if (data instanceof FormData) {
			this.body(data as TBody);
		} else {
			const formData = new FormData();
			Object.entries(data).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					formData.append(key, String(value));
				}
			});
			this.body(formData as TBody);
		}
		return this;
	}

	/**
	 * Configure authentication for this request
	 * Pass null to disable authentication for this request
	 * @param strategy - Authentication strategy or null to disable
	 * @returns RequestBuilder instance for chaining
	 */
	auth(strategy: AuthStrategy | null): this {
		this._auth = strategy;
		return this;
	}

	/**
	 * Enable or disable deduplication for this request.
	 * Dedupe is enabled by default.
	 * If enabled, the request will be deduplicated based on the method, URL, body, and headers.
	 * If a request with the same parameters is already in progress, it will return the same promise.
	 * @param enable - Whether to enable deduplication
	 * @returns RequestBuilder instance for chaining
	 */
	dedupe(enable = true): this {
		this._dedupe = enable;
		return this;
	}

	/**
	 * Execute the HTTP request and return only the data
	 * @returns Promise resolving to the response data
	 */
	async data(): Promise<TResp> {
		const response = await this.client._execute<TResp, TBody, TQuery>(this);

		// If response.data is a JSON string, try to parse it
		if (typeof response.data === "string" &&
		    (response.data.startsWith("{") || response.data.startsWith("[")) &&
		    (response.data.endsWith("}") || response.data.endsWith("]"))) {
			try {
				return JSON.parse(response.data) as TResp;
			} catch {
				// If parsing fails, return as is
				return response.data;
			}
		}

		return response.data;
	}

	/**
	 * Execute the HTTP request and return the full response
	 * @returns Promise resolving to the full HTTP response
	 */
	send(): Promise<HttpResponse<TResp>> {
		return this.client._execute<TResp, TBody, TQuery>(this);
	}

	/**
	 * Set request timeout
	 * @param ms - Timeout in milliseconds
	 * @returns RequestBuilder instance for chaining
	 */
	timeout(ms: number): this {
		this._timeout = ms;
		return this;
	}

	/**
	 * Set abort signal for request cancellation
	 * @param signal - AbortSignal instance
	 * @returns RequestBuilder instance for chaining
	 */
	signal(signal: AbortSignal): this {
		this._signal = signal;
		return this;
	}

	/**
	 * Set retry strategy for this request
	 * @param strategy - Retry strategy or null to disable retries
	 * @returns RequestBuilder instance for chaining
	 */
	retry(strategy: RetryStrategy | null): this {
		this._retry = strategy;
		return this;
	}
}
