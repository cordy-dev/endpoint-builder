import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * Exponential backoff with jitter (randomization)
 */
export class JitteredExponentialBackoffRetryStrategy implements RetryStrategy {
	constructor(
		public maxAttempts: number,
		private baseDelay: number = 1000,
		private maxDelay: number = 30000,
		private multiplier: number = 2,
		private jitterFactor: number = 0.1 // 10% jitter
	) {}

	calculateDelay(attempt: number, _error: HttpError): number | null {
		if (attempt >= this.maxAttempts) {
			return null;
		}

		const exponentialDelay = this.baseDelay * Math.pow(this.multiplier, attempt);
		const boundedDelay = Math.min(exponentialDelay, this.maxDelay);

		// Add random jitter
		const jitter = boundedDelay * this.jitterFactor * (Math.random() - 0.5) * 2;
		const finalDelay = boundedDelay + jitter;

		return Math.max(finalDelay, 0); // Ensure non-negative
	}

	shouldRetry(error: HttpError): boolean {
		return (error.status !== undefined && (error.status >= 500 || error.status === 429)) || error.status === 0;
	}
}
