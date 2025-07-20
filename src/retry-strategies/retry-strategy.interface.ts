import type { HttpError } from "../core/types";

/**
 * Retry strategy interface for flexible retry policies
 */
export interface RetryStrategy {
	/**
	 * Calculate delay for the next retry attempt
	 * @param attempt Current attempt number (0-based)
	 * @param error The error that triggered the retry
	 * @returns Delay in milliseconds, or null to stop retrying
	 */
	calculateDelay(attempt: number, error: HttpError): number | null;

	/**
	 * Determine if this error should trigger a retry
	 * @param error The error to check
	 * @returns True if retry should be attempted
	 */
	shouldRetry(error: HttpError): boolean;

	/**
	 * Maximum number of retry attempts
	 */
	maxAttempts: number;
}
