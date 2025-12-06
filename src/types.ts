export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type ResponseType = "json" | "text" | "blob" | "stream" | "arraybuffer";
export type BodyLike = BodyInit | Record<string, unknown> | null | object | undefined;

/**
 * Query parameters type - supports primitives, arrays, and nested objects
 */
export type QueryParams = Record<string, string | number | boolean | null | undefined | (string | number | boolean)[] | Record<string, unknown>>;

/**
 * Request interceptor - called before each request
 */
export interface RequestInterceptor {
	onRequest(config: HttpRequestConfig): HttpRequestConfig | Promise<HttpRequestConfig>;
}

/**
 * Response interceptor - called after each response
 */
export interface ResponseInterceptor {
	onResponse<T>(response: HttpResponse<T>): HttpResponse<T> | Promise<HttpResponse<T>>;
	onError?(error: HttpError): HttpError | Promise<HttpError>;
}

export interface HttpHeaders {
	[key: string]: string | string[] | undefined;
}

export interface HttpError extends Error {
	config: HttpRequestConfig;
	response?: HttpResponse;
	status?: number;
	statusText?: string;
	code?: string;
}

export interface HttpRequestConfig {
	url: string;
	method: HttpMethod;
	headers?: HttpHeaders;
	body?: any;
	timeout?: number;
	signal?: AbortSignal;
	responseType?: ResponseType;
}

export interface HttpResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	headers: HttpHeaders;
	config: HttpRequestConfig;
}