import type { ApiError } from "../errors";

/**
 * Result type for safe operations
 * Inspired by Rust's Result type
 */
export type Result<T, E = ApiError> =
	| { data: T; error: undefined }
	| { data: undefined; error: E };

/**
 * Create a success result
 */
export function ok<T>(data: T): Result<T, never> {
	return { data, error: undefined };
}

/**
 * Create an error result
 */
export function err<E>(error: E): Result<never, E> {
	return { data: undefined, error };
}

/**
 * Type guard for success result
 */
export function isOk<T, E>(result: Result<T, E>): result is { data: T; error: undefined } {
	return result.error === undefined;
}

/**
 * Type guard for error result
 */
export function isErr<T, E>(result: Result<T, E>): result is { data: undefined; error: E } {
	return result.error !== undefined;
}

/**
 * Unwrap a Result, throwing if it's an error
 */
export function unwrapResult<T, E extends Error>(result: Result<T, E>): T {
	if (isErr(result)) {
		throw result.error;
	}
	return result.data;
}

/**
 * Unwrap a Result with a default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
	if (isErr(result)) {
		return defaultValue;
	}
	return result.data;
}

/**
 * Map over a successful Result
 */
export function mapResult<T, U, E>(
	result: Result<T, E>,
	fn: (data: T) => U
): Result<U, E> {
	if (isErr(result)) {
		return result;
	}
	return ok(fn(result.data));
}

/**
 * Map over an error Result
 */
export function mapErr<T, E, F>(
	result: Result<T, E>,
	fn: (error: E) => F
): Result<T, F> {
	if (isOk(result)) {
		return result;
	}
	return err(fn(result.error));
}
