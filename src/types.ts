import type { HttpMethod, ResponseType } from "./constants";

/**
 * Request body types
 */
export type BodyLike = BodyInit | Record<string, unknown> | null | object | undefined;

/**
 * Query parameters type
 */
export type QueryParams = Record<string, string | number | boolean | null | undefined>;

/**
 * HTTP headers interface with flexible value types
 */
export interface HttpHeaders {
	[key: string]: string | string[] | undefined;
}

/**
 * Enhanced HTTP error with additional context
 */
export interface HttpError extends Error {
	config: HttpRequestConfig;
	response?: HttpResponse;
	status?: number;
	statusText?: string;
	code?: string;
	isTimeout?: boolean;
	isNetworkError?: boolean;
	isAborted?: boolean;
}

/**
 * Configuration for HTTP requests
 */
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

// Re-export from constants for convenience
export type { HttpMethod, ResponseType };

export interface HttpResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	headers: HttpHeaders;
	config: HttpRequestConfig;
}