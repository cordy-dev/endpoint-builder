import type { HttpRequestConfig } from "../types";

/**
 * HTTP error for failed requests (4xx, 5xx status codes)
 */
export class HttpError extends Error {
	readonly type = "http" as const;
	override readonly name = "HttpError";

	constructor(
		public readonly status: number,
		public readonly statusText: string,
		public readonly response?: unknown,
		public readonly request?: HttpRequestConfig
	) {
		super(`HTTP ${status}: ${statusText}`);
	}
}
