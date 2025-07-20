/**
 * Core HTTP-agnostic types for the endpoint builder
 */

import type { RetryStrategy } from "../retry-strategies";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type ResponseType = "json" | "text" | "blob" | "stream" | "arraybuffer";

export interface HttpHeaders {
	[key: string]: string | string[] | undefined;
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

export interface HttpError extends Error {
	config: HttpRequestConfig;
	response?: HttpResponse;
	status?: number;
	statusText?: string;
	code?: string;
}

/**
 * Authentication strategy interface
 */
export interface AuthStrategy {
	/**
	 * Apply authentication to request configuration
	 * @param config The request configuration to modify
	 * @returns Modified request configuration
	 */
	applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig>;

	/**
	 * Check if error is authentication related
	 * @param error The HTTP error to check
	 * @returns True if this is an auth error
	 */
	isAuthError?(error: HttpError): boolean;

	/**
	 * Handle authentication errors (e.g., token refresh)
	 * @param error The HTTP error that occurred
	 * @returns New request config to retry with, or null to not retry
	 */
	handleAuthError?(error: HttpError): Promise<HttpRequestConfig | null>;
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
	attempts: number;
	delay: number;
	/**
	 * Custom retry strategy (optional)
	 * If provided, attempts and delay are ignored
	 */
	strategy?: RetryStrategy;
}

/**
 * Mock response configuration
 */
export interface MockResponse<T = any> {
	data: T;
	status?: number;
	statusText?: string;
	headers?: HttpHeaders;
	delay?: number;
}

/**
 * Upload progress callback
 */
export interface UploadProgress {
	loaded: number;
	total: number;
	percentage: number;
}

export type ProgressCallback = (progress: UploadProgress) => void;

/**
 * Execution options for requests
 */
export interface ExecutionOptions {
	timeout?: number;
	signal?: AbortSignal;
	delay?: number;
	mock?: boolean;
	mockOnly?: boolean; // If true, only mock responses are used (throws error if no mock)
	cache?: boolean; // If true, identical parallel requests will be cached/deduplicated
	onUploadProgress?: ProgressCallback;
	onDownloadProgress?: ProgressCallback;
}

/**
 * HTTP client configuration options
 */
export interface HttpClientOptions {
	mockOnly?: boolean; // Global mock-only mode for development
	cache?: boolean; // Global request caching/deduplication
	timeout?: number; // Default timeout for all requests
}
