import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * Exponential backoff retry strategy
 */
export class ExponentialBackoffRetryStrategy implements RetryStrategy {
	constructor(
		public maxAttempts: number,
		private baseDelay: number = 1000,
		private maxDelay: number = 30000,
		private multiplier: number = 2
	) {}

	calculateDelay(attempt: number, _error: HttpError): number | null {
		if (attempt >= this.maxAttempts) {
			return null;
		}

		const delay = this.baseDelay * Math.pow(this.multiplier, attempt);
		return Math.min(delay, this.maxDelay);
	}

	shouldRetry(error: HttpError): boolean {
		return (error.status !== undefined && (error.status >= 500 || error.status === 429)) || error.status === 0;
	}
}
