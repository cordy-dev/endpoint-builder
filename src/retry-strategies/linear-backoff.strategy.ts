import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * Linear backoff retry strategy
 */
export class LinearBackoffRetryStrategy implements RetryStrategy {
	constructor(
		public maxAttempts: number,
		private baseDelay: number = 1000,
		private increment: number = 1000
	) {}

	calculateDelay(attempt: number, _error: HttpError): number | null {
		if (attempt >= this.maxAttempts) {
			return null;
		}

		return this.baseDelay + (attempt * this.increment);
	}

	shouldRetry(error: HttpError): boolean {
		return (error.status !== undefined && error.status >= 500) || error.status === 0;
	}
}
