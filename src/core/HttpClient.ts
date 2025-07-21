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
  mock?: boolean; // Добавляем параметр для режима моков
}

export class HttpClient {
	readonly defaults: Required<HttpClientOptions>;
	private inflight = new Map<string, Promise<unknown>>();

	constructor(opts: HttpClientOptions = {}) {
		this.defaults = {
			baseUrl       : "",
			auth          : null,
			storage       : opts.storage ?? new LocalStoragePersist(),
			dedupe        : false,
			defaultHeaders: {},
			responseType  : undefined,
			retryStrategy : new JitteredExponentialBackoffRetryStrategy(),
			mock          : false, // Добавляем значение по умолчанию для mock
			...opts,
		} as Required<HttpClientOptions>;
	}

	/**
	 * Creates a new RequestBuilder for the specified HTTP method and URL.
	 * @param url - The URL for the request
	 * @returns a new RequestBuilder instance
	 * @throws Error if the URL is not provided
	 */
	get <T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, undefined, Q>(this, path).method("GET");
	}

	/**
	 * Creates a new RequestBuilder for the specified HTTP method and URL.
	 * @param url - The URL for the request
	 * @returns a new RequestBuilder instance
	 * @throws Error if the URL is not provided
	 * @template T - The expected response type
	 * @template B - The body type for the request
	 * @template Q - The query parameters type for the request
	 */
	post<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("POST");
	}

	/**
	 * Creates a new RequestBuilder for the specified HTTP method and URL.
	 * @param url - The URL for the request
	 * @returns a new RequestBuilder instance
	 * @throws Error if the URL is not provided
	 * @template T - The expected response type
	 * @template B - The body type for the request
	 * @template Q - The query parameters type for the request
	 */
	put  <T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("PUT");
	}

	/**
	 * Creates a new RequestBuilder for the specified HTTP method and URL.
	 * @param url - The URL for the request
	 * @returns a new RequestBuilder instance
	 * @throws Error if the URL is not provided
	 * @template T - The expected response type
	 * @template B - The body type for the request
	 * @template Q - The query parameters type for the request
	 */
	patch<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, B, Q>(this, path).method("PATCH");
	}

	/**
	 * Creates a new RequestBuilder for the specified HTTP method and URL.
	 * @param url - The URL for the request
	 * @returns a new RequestBuilder instance
	 * @throws Error if the URL is not provided
	 * @template T - The expected response type
	 */
	delete<T = any, Q extends Record<string, unknown> | undefined = undefined>(path: string) {
		return new RequestBuilder<T, undefined, Q>(this, path).method("DELETE");
	}

	async _execute<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): Promise<HttpResponse<T>> {
		const dedupe = rb._dedupe ?? this.defaults.dedupe;
		const key = dedupe ? this._dedupeKey(rb) : undefined;
		if (key && this.inflight.has(key)) return this.inflight.get(key) as Promise<HttpResponse<T>>;

		const run = async (): Promise<HttpResponse<T>> => {
			let attempt = 0;
			while (true) {
				attempt++;
				const cfg = await this._buildConfig(rb);
				const controller = cfg.signal ? undefined : new AbortController();
				const timeoutId = cfg.timeout && controller ? setTimeout(() => controller.abort("timeout"), cfg.timeout) : undefined;
				const signal = cfg.signal ?? controller?.signal;

				let res: Response | undefined;
				try {
					res = await fetch(cfg.url, {
						method: cfg.method,
						headers: cfg.headers as HeadersInit,
						body: serializeBody(cfg.body, cfg.headers ?? {}),
						signal,
					});
				} catch (err) {
					if ((err as any).name === "AbortError") throw err;
				} finally {
					clearTimeout(timeoutId);
				}

				// refresh token if needed
				if (res && this.defaults.auth?.refresh && await this.defaults.auth.refresh(new Request(cfg.url), res)) {
					continue; // retry immediately, don't count attempt
				}

				// decide retry
				const retryCtx: RetryContext = { attempt, response: res, config: cfg };
				const retryStrat = rb._retry ?? this.defaults.retryStrategy;
				if (res && res.ok === false) {
					const should = retryStrat?.shouldRetry(retryCtx) ?? false;
					if (should) {
						const delay = await retryStrat!.nextDelay(retryCtx);
						await new Promise(r => setTimeout(r, delay));
						continue;
					}
				}

				if (!res || !res.ok) {
					const err = new Error(`HTTP ${(res && res.status) || "fetch"}`) as HttpError;
					err.config = cfg;
					if (res) {
						err.status = res.status;
						err.statusText = res.statusText;
						err.response = {
							data: undefined,
							status: res.status,
							statusText: res.statusText,
							headers: this._respHeaders(res),
							config: cfg,
						};
					}
					throw err;
				}

				const data = await decodeResponse<T>(res, cfg);
				return {
					data,
					status: res.status,
					statusText: res.statusText,
					headers: this._respHeaders(res),
					config: cfg
				};
			}
		};

		const p = run().finally(() => key && this.inflight.delete(key));
		if (key) this.inflight.set(key, p);
		return p;
	}

	private _respHeaders(r: Response): HttpHeaders {
		const h: HttpHeaders = {};
		r.headers.forEach((v, k) => h[k] = v);
		return h;
	}

	/* ---------------- helpers ------------------- */
	private _dedupeKey<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): string {
		return JSON.stringify([
			rb._method,
			rb.input,
			rb._query,
			rb._body,
		]);
	}

	private async _buildConfig<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(rb: RequestBuilder<T, B, Q>): Promise<HttpRequestConfig> {
		// Обеспечиваем валидный baseUrl для URL конструктора
		const baseUrl = this.defaults.baseUrl || "http://localhost";
		const url = new URL(rb.input, baseUrl);
		if (rb._query) url.search = toQuery(rb._query);

		let hdr: HttpHeaders = mergeHeaders({}, this.defaults.defaultHeaders);
		hdr = mergeHeaders(hdr, rb._headers);

		const auth = rb._auth ?? this.defaults.auth;
		if (auth) hdr = mergeHeaders(hdr, await auth.enrich(new Request(url.toString())));

		return {
			url       : url.toString(),
			method    : rb._method,
			headers   : hdr,
			body      : rb._body,
			responseType: rb._responseType ?? this.defaults.responseType,
		};
	}

	_clone(patch: Partial<HttpClientOptions>): HttpClient {
		return new HttpClient({ ...this.defaults, ...patch });
	}

	_wrap<T = any, B extends BodyLike = BodyLike, Q extends Record<string, unknown> | undefined = undefined>(builder: RequestBuilder<T, B, Q>): RequestBuilder<T, B, Q> {
		const rb = new RequestBuilder<T, B, Q>(this, builder.input);
		rb._method        = builder._method;
		rb._body          = builder._body;
		rb._headers       = { ...builder._headers };
		rb._dedupe        = builder._dedupe;
		rb._query         = builder._query;
		rb._responseType  = builder._responseType;
		return rb;
	}
}