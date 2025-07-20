import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * Fixed delay retry strategy
 */
export class FixedDelayRetryStrategy implements RetryStrategy {
	constructor(
		public maxAttempts: number,
		private delay: number
	) {}

	calculateDelay(attempt: number, _error: HttpError): number | null {
		if (attempt >= this.maxAttempts) {
			return null;
		}
		return this.delay;
	}

	shouldRetry(error: HttpError): boolean {
		// Retry on network errors and 5xx server errors
		return (error.status !== undefined && error.status >= 500) || error.status === 0;
	}
}
