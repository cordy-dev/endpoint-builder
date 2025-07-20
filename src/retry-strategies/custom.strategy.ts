import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * Custom retry strategy with user-defined logic
 */
export class CustomRetryStrategy implements RetryStrategy {
	constructor(
		public maxAttempts: number,
		private delayFunction: (attempt: number, error: HttpError) => number | null,
		private shouldRetryFunction: (error: HttpError) => boolean
	) {}

	calculateDelay(attempt: number, error: HttpError): number | null {
		if (attempt >= this.maxAttempts) {
			return null;
		}
		return this.delayFunction(attempt, error);
	}

	shouldRetry(error: HttpError): boolean {
		return this.shouldRetryFunction(error);
	}
}
