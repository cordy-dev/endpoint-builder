export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ResponseType = "json" | "text" | "blob" | "stream" | "arraybuffer";
export type BodyLike = BodyInit | Record<string, unknown> | null | object | undefined;

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