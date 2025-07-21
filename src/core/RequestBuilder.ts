import type { AuthStrategy } from "../auth";
import type { RetryStrategy } from "../retry/RetryStrategy";
import type { HttpHeaders, HttpMethod, HttpResponse, ResponseType } from "../types";
import { mergeHeaders } from "../utils/mergeHeaders";
import type { BodyLike,HttpClient } from "./HttpClient";

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

	constructor(private client: HttpClient, readonly input: string) {
		this._dedupe = client.defaults.dedupe;
	}

	/** Установить метод */
	method<M extends HttpMethod>(m: M) {
		this._method = m;
		return this as unknown as RequestBuilder<TResp, TBody, TQuery>;
	}

	query<Q extends Record<string, unknown>>(q: Q) {
		this._query = q as unknown as TQuery;
		return this as unknown as RequestBuilder<TResp, TBody, Q>;
	}

	headers(h: HttpHeaders) {
		this._headers = mergeHeaders(this._headers, h);
		return this;
	}

	/**
	 * Set a single header for the request
	 * @param name - Header name
	 * @param value - Header value
	 */
	header(name: string, value: string): this {
		this._headers[name] = value;
		return this;
	}

	responseType<R extends ResponseType>(rt: R) {
		this._responseType = rt;
		return this as unknown as RequestBuilder<TResp, TBody, TQuery>;
	}

	body<B extends BodyLike>(b: B) {
		this._body = b as unknown as TBody;
		return this as unknown as RequestBuilder<TResp, B, TQuery>;
	}


	json<B extends object & BodyLike>(b: B) {
		this._body = b as unknown as TBody;
		this.headers({ "Content-Type": "application/json" });
		return this as unknown as RequestBuilder<TResp, B, TQuery>;
	}


	/**
	 * Set the request body to a FormData or URL-encoded form
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
	 */
	auth(a: AuthStrategy | null) {
		this._auth = a;
		return this;
	}

	/**
	 * Enable or disable deduplication for this request.
	 * Dedupe is enabled by default.
	 * If enabled, the request will be deduplicated based on the method, URL, body, and headers.
	 * If a request with the same parameters is already in progress, it will return the same promise.
	 */
	dedupe(enable = true) {
		this._dedupe = enable;
		return this;
	}

	/**
	 * Execute the HTTP request and return only the data
	 */
	async data(): Promise<TResp> {
		const response = await this.client._execute<TResp, TBody, TQuery>(this);

		// Если response.data - это строка JSON, попробуем ее распарсить
		if (typeof response.data === "string" &&
		    (response.data.startsWith("{") || response.data.startsWith("[")) &&
		    (response.data.endsWith("}") || response.data.endsWith("]"))) {
			try {
				return JSON.parse(response.data) as TResp;
			} catch (_) {
				// Если не смогли распарсить, вернем как есть
				return response.data;
			}
		}

		return response.data;
	}

	  /**
	   * Execute the HTTP request
	   */
	  send(): Promise<HttpResponse<TResp>> {
		return this.client._execute<TResp, TBody, TQuery>(this);
	  }

	timeout(ms: number) {
		this._timeout = ms;
		return this;
	}

	signal(sig: AbortSignal) {
		this._signal = sig;
		return this;
	}

	retry(strat: RetryStrategy|null){ this._retry = strat; return this; }

	/**
	 * Create a new builder with mock mode enabled
	 */
	mock() {
		const newClient = this.client._clone({ mock: true });
		return newClient._wrap(this);
	}
}
