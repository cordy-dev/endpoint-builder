/**
 * Result of a `.safe()` call. Discriminated by `ok` (or by `error`).
 */
export type Result<T, E> =
	| { readonly ok: true; readonly data: T; readonly error: undefined }
	| { readonly ok: false; readonly data: undefined; readonly error: E };

export function ok<T>(data: T): Result<T, never> {
	return { ok: true, data, error: undefined };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, data: undefined, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: true }> {
	return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Extract<Result<T, E>, { ok: false }> {
	return !result.ok;
}

/** Return the data or throw the error */
export function unwrap<T, E>(result: Result<T, E>): T {
	if (result.ok) return result.data;
	// eslint-disable-next-line @typescript-eslint/only-throw-error
	throw result.error;
}

/** Return the data or a fallback */
export function unwrapOr<T, U>(result: Result<T, unknown>, fallback: U): T | U {
	return result.ok ? result.data : fallback;
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
	return result.ok ? ok(fn(result.data)) : result;
}

export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
	return result.ok ? result : err(fn(result.error));
}
