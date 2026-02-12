import type { AuthStrategy } from "../auth";
import type { ApiError } from "../errors";
import { ValidationError } from "../errors";
import type { RetryStrategy } from "../retry/RetryStrategy";
import type { BodyLike, HttpHeaders, HttpMethod, HttpResponse, ResponseType } from "../types";
import type { Result } from "../types/result";
import { err, ok } from "../types/result";
import type { InferOutput, StandardSchema } from "../types/schema";
import { validateWithSchema } from "../types/schema";
import { mergeHeaders } from "../utils/mergeHeaders";
import type { HttpClient } from "./HttpClient";

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
	/* internal */ _dedupe!: boolean;
	/* internal */ _query?: TQuery;
	/* internal */ _responseType?: ResponseType;
	/* internal */ _timeout?: number;
	/* internal */ _signal?: AbortSignal;
	/* internal */ _retry?: RetryStrategy | null;
	/* internal */ _auth?: AuthStrategy | null;
	/* internal */ _unwrap?: ((data: unknown) => unknown) | false;

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
		if (urlencoded) {
			this.header("Content-Type", "application/x-www-form-urlencoded");
		}
		// For multipart/form-data, don't set Content-Type manually.
		// The runtime must set it automatically to include the boundary parameter.

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

	/**
	 * Set unwrap function or disable unwrapping for this request
	 * @param fn - Unwrap function, or false to disable global unwrap
	 * @returns RequestBuilder instance for chaining
	 */
	unwrap(fn: ((data: unknown) => unknown) | false): this {
		this._unwrap = fn;
		return this;
	}

	/**
	 * Validate response with a Standard Schema
	 * @param schema - Standard Schema compliant schema
	 * @returns SchemaRequestBuilder for chained validation operations
	 */
	schema<S extends StandardSchema>(
		schema: S
	): SchemaRequestBuilder<InferOutput<S>, TBody, TQuery> {
		return new SchemaRequestBuilder<InferOutput<S>, TBody, TQuery>(
			this.client,
			this as RequestBuilder<unknown, TBody, TQuery>,
			schema as StandardSchema<InferOutput<S>>
		);
	}
}

/**
 * Request builder with schema validation
 */
export class SchemaRequestBuilder<
	TResp,
	TBody extends BodyLike = BodyLike,
	TQuery extends Record<string, unknown> | undefined = undefined
> {
	constructor(
		private readonly client: HttpClient,
		private readonly request: RequestBuilder<unknown, TBody, TQuery>,
		private readonly _schema: StandardSchema<TResp>
	) {}

	/**
	 * Execute request, validate response, and return data (throws on error)
	 */
	async then<TResult1 = TResp, TResult2 = never>(
		onfulfilled?: ((value: TResp) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		try {
			const data = await this.getData();
			return onfulfilled ? onfulfilled(data) : (data as unknown as TResult1);
		} catch (error) {
			if (onrejected) {
				return onrejected(error);
			}
			throw error;
		}
	}

	/**
	 * Execute request and validate response
	 */
	private async getData(): Promise<TResp> {
		const response = await this.client._execute(this.request);
		const result = await validateWithSchema(this._schema, response.data);

		if (!result.success) {
			throw new ValidationError(result.issues, response.data);
		}

		return result.data;
	}

	/**
	 * Execute request and return Result (never throws)
	 */
	async safe(): Promise<Result<TResp, ApiError>> {
		try {
			const data = await this.getData();
			return ok(data);
		} catch (error) {
			return err(error as ApiError);
		}
	}

	/**
	 * Transform validated data
	 */
	transform<U>(fn: (data: TResp) => U): TransformRequestBuilder<U, TResp, TBody, TQuery> {
		return new TransformRequestBuilder(this.client, this.request, this._schema, fn);
	}
}

/**
 * Request builder with schema validation and transform
 */
export class TransformRequestBuilder<
	TResult,
	TResp,
	TBody extends BodyLike = BodyLike,
	TQuery extends Record<string, unknown> | undefined = undefined
> {
	constructor(
		private readonly client: HttpClient,
		private readonly request: RequestBuilder<unknown, TBody, TQuery>,
		private readonly _schema: StandardSchema<TResp>,
		private readonly _transform: (data: TResp) => TResult
	) {}

	/**
	 * Execute request, validate, transform, and return data (throws on error)
	 */
	async then<TResult1 = TResult, TResult2 = never>(
		onfulfilled?: ((value: TResult) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2> {
		try {
			const data = await this.getData();
			return onfulfilled ? onfulfilled(data) : (data as unknown as TResult1);
		} catch (error) {
			if (onrejected) {
				return onrejected(error);
			}
			throw error;
		}
	}

	/**
	 * Execute request, validate, and transform
	 */
	private async getData(): Promise<TResult> {
		const response = await this.client._execute(this.request);
		const result = await validateWithSchema(this._schema, response.data);

		if (!result.success) {
			throw new ValidationError(result.issues, response.data);
		}

		return this._transform(result.data);
	}

	/**
	 * Execute request and return Result (never throws)
	 */
	async safe(): Promise<Result<TResult, ApiError>> {
		try {
			const data = await this.getData();
			return ok(data);
		} catch (error) {
			return err(error as ApiError);
		}
	}
}
