import type { HttpError } from "../core/types";
import type { RetryStrategy } from "./retry-strategy.interface";

/**
 * No retry strategy - disables retrying completely
 */
export class NoRetryStrategy implements RetryStrategy {
	maxAttempts = 0;

	calculateDelay(_attempt: number, _error: HttpError): null {
		return null;
	}

	shouldRetry(_error: HttpError): boolean {
		return false;
	}
}
