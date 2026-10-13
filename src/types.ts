import type { AuthStrategy } from "./auth/types";
import type { RetryOptions } from "./retry";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** How the response body is read. `auto` picks JSON / text / blob from Content-Type. */
export type ResponseType = "auto" | "json" | "text" | "blob" | "arrayBuffer" | "formData" | "stream";

export type HeaderValue = string | number | boolean | null | undefined;
/** Header input: plain object (undefined/null values are skipped), tuple list or native `Headers` */
export type HeadersInput = Record<string, HeaderValue> | [string, string][] | Headers;

export type QueryPrimitive = string | number | boolean | bigint | Date | null | undefined;
export type QueryValue = QueryPrimitive | readonly QueryValue[] | { readonly [key: string]: QueryValue };
export type QueryObject = { readonly [key: string]: QueryValue };
/** Query input: object, raw string or `URLSearchParams` */
export type QueryInput = QueryObject | string | URLSearchParams;

/**
 * Mutable request state that flows through the middleware pipeline.
 * Comparable to `HttpRequestMessage` in .NET.
 */
export interface RequestContext {
	/** Absolute (or base-relative) URL including the query string */
	url: string;
	method: HttpMethod;
	headers: Headers;
	/** Already-serialized body */
	body: BodyInit | null | undefined;
	/** User supplied abort signal */
	signal: AbortSignal | undefined;
	/** Per-attempt timeout in ms (`undefined` = none) */
	timeout: number | undefined;
	/** Effective retry policy for this request (`false` = disabled) */
	retry: RetryOptions | false;
	/** Effective auth strategy for this request (`false` = anonymous) */
	auth: AuthStrategy | false;
	/** Share one network call between identical concurrent GET/HEAD requests */
	dedupe: boolean;
	/** Extra `RequestInit` fields passed straight to `fetch` (credentials, cache, mode, ...) */
	init: RequestInitExtras;
	/** 1-based attempt counter, maintained by the retry middleware */
	attempt: number;
	/** Free-form per-request bag for middleware (like `HttpRequestMessage.Options`) */
	meta: Record<string, unknown>;
}

/** `RequestInit` fields that are not managed by the builder itself */
export type RequestInitExtras = Omit<RequestInit, "method" | "headers" | "body" | "signal"> & Record<string, unknown>;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HttpResponse<T> {
	readonly data: T;
	readonly status: number;
	readonly statusText: string;
	readonly headers: Headers;
	/** The native response (body already consumed unless `stream()`/`raw()` was used) */
	readonly response: Response;
	readonly request: RequestContext;
}

export type MaybePromise<T> = T | Promise<T>;

/** Flatten intersections for readable hovers */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
