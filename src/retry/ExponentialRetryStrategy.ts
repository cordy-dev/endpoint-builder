import type { RetryContext, RetryStrategy } from "./RetryStrategy";

export interface ExponentialRetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxAttempts?: number;
	/** Base delay in milliseconds (default: 300) */
	baseDelay?: number;
	/** Maximum delay in milliseconds (default: 10000) */
	maxDelay?: number;
	/** Status codes that should trigger a retry (default: [429, 500, 502, 503, 504]) */
	retryStatusCodes?: number[];
	/** Whether to respect Retry-After header (default: true) */
	respectRetryAfter?: boolean;
	/** Whether to retry on network errors (default: true) */
	retryOnNetworkError?: boolean;
}

// Default status codes that should trigger a retry
const DEFAULT_RETRY_STATUS_CODES = [429, 500, 502, 503, 504];

export class ExponentialRetryStrategy implements RetryStrategy {
	private readonly maxAttempts: number;
	private readonly baseDelay: number;
	private readonly maxDelay: number;
	private readonly retryStatusCodes: Set<number>;
	private readonly respectRetryAfter: boolean;
	private readonly retryOnNetworkError: boolean;

	constructor(options: ExponentialRetryOptions = {}) {
		this.maxAttempts = options.maxAttempts ?? 3;
		this.baseDelay = options.baseDelay ?? 300;
		this.maxDelay = options.maxDelay ?? 10_000;
		this.retryStatusCodes = new Set(options.retryStatusCodes ?? DEFAULT_RETRY_STATUS_CODES);
		this.respectRetryAfter = options.respectRetryAfter ?? true;
		this.retryOnNetworkError = options.retryOnNetworkError ?? true;
	}

	shouldRetry(ctx: RetryContext): boolean {
		if (ctx.attempt >= this.maxAttempts) return false;

		// Network / CORS failure => no response
		if (!ctx.response) {
			return this.retryOnNetworkError;
		}

		const status = ctx.response.status;
		return this.retryStatusCodes.has(status);
	}

	nextDelay(ctx: RetryContext): number {
		// Check for Retry-After header
		if (this.respectRetryAfter && ctx.response) {
			const retryAfter = ctx.response.headers.get("Retry-After");
			if (retryAfter) {
				const delay = this.parseRetryAfter(retryAfter);
				if (delay !== null) {
					return Math.min(delay, this.maxDelay);
				}
			}
		}

		// Exponential backoff with full jitter
		const exp = Math.min(this.baseDelay * 2 ** (ctx.attempt - 1), this.maxDelay);
		return exp / 2 + Math.random() * (exp / 2);
	}

	/**
	 * Parse Retry-After header value
	 * Supports both delay-seconds and HTTP-date formats
	 */
	private parseRetryAfter(value: string): number | null {
		// Try to parse as number (delay-seconds)
		const seconds = parseInt(value, 10);
		if (!isNaN(seconds)) {
			return seconds * 1000;
		}

		// Try to parse as HTTP-date
		const date = Date.parse(value);
		if (!isNaN(date)) {
			const delay = date - Date.now();
			return delay > 0 ? delay : null;
		}

		return null;
	}
}