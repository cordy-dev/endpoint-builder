import { formatIssuePath, type Issue } from "../schema";
import type { HttpMethod } from "../types";

/** Minimal request descriptor attached to every error */
export interface ErrorRequest {
	readonly method: HttpMethod;
	readonly url: string;
}

export type ErrorType = "http" | "network" | "timeout" | "abort" | "validation" | "parse" | "size";

/** Base class of every error thrown by the library */
export abstract class EndpointError extends Error {
	abstract readonly type: ErrorType;

	constructor(message: string, readonly request: ErrorRequest | undefined, options?: { cause?: unknown }) {
		super(message, options);
	}

	static is(value: unknown): value is ApiError {
		return value instanceof EndpointError;
	}
}

/** Non-2xx response. `body` holds the parsed (and, if declared, validated) error payload. */
export class HttpError<TStatus extends number = number, TBody = unknown> extends EndpointError {
	readonly type = "http" as const;
	override readonly name = "HttpError";

	constructor(
		readonly status: TStatus,
		readonly statusText: string,
		readonly body: TBody,
		readonly headers: Headers,
		readonly response: Response,
		request: ErrorRequest | undefined,
	) {
		super(`HTTP ${status}${statusText ? ` ${statusText}` : ""}${request ? ` (${request.method} ${request.url})` : ""}`, request);
	}
}

/** Connection failure, DNS error, CORS rejection, ... */
export class NetworkError extends EndpointError {
	readonly type = "network" as const;
	override readonly name = "NetworkError";

	constructor(message: string, request: ErrorRequest | undefined, cause?: unknown) {
		super(message, request, { cause });
	}
}

/** The per-attempt timeout elapsed */
export class TimeoutError extends EndpointError {
	readonly type = "timeout" as const;
	override readonly name = "TimeoutError";

	constructor(readonly timeout: number, request: ErrorRequest | undefined) {
		super(`Request timed out after ${timeout}ms${request ? ` (${request.method} ${request.url})` : ""}`, request);
	}
}

/** The request was cancelled through the user supplied `AbortSignal` */
export class AbortError extends EndpointError {
	readonly type = "abort" as const;
	override readonly name = "AbortError";

	constructor(request: ErrorRequest | undefined, reason?: unknown) {
		super("Request was aborted", request, { cause: reason });
	}
}

export type ValidationStage = "params" | "query" | "headers" | "body" | "response" | "error";

/** A schema rejected request input or response output */
export class ValidationError extends EndpointError {
	readonly type = "validation" as const;
	override readonly name = "ValidationError";

	constructor(
		readonly stage: ValidationStage,
		readonly issues: readonly Issue[],
		readonly value: unknown,
		request: ErrorRequest | undefined,
		cause?: unknown,
	) {
		const first = issues[0];
		const where = first?.path?.length ? ` at "${formatIssuePath(first.path)}"` : "";
		const more = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
		super(`Invalid ${stage}${where}: ${first?.message ?? "validation failed"}${more}`, request, { cause });
	}
}

/** The response body could not be decoded (e.g. malformed JSON) */
export class ParseError extends EndpointError {
	readonly type = "parse" as const;
	override readonly name = "ParseError";

	constructor(message: string, readonly text: string, request: ErrorRequest | undefined, cause?: unknown) {
		super(message, request, { cause });
	}
}

/** The response body is larger than `maxResponseBytes` */
export class SizeLimitError extends EndpointError {
	readonly type = "size" as const;
	override readonly name = "SizeLimitError";

	constructor(readonly limit: number, request: ErrorRequest | undefined, readonly declared?: number) {
		super(
			`Response body exceeds ${limit} bytes${declared === undefined ? "" : ` (Content-Length: ${declared})`}${request ? ` (${request.method} ${request.url})` : ""}`,
			request,
		);
	}
}

/** Map of status code → error body type, e.g. `{ 404: NotFound; 422: Problem }` */
export type ErrorMap = Record<number, unknown>;

/** Union of declared HTTP errors */
export type DeclaredHttpError<TErrors extends ErrorMap> = {
	[K in keyof TErrors & number]: HttpError<K, TErrors[K]>
}[keyof TErrors & number];

/** Every error a request can fail with */
export type ApiError<TErrors extends ErrorMap = {}> =
	| DeclaredHttpError<TErrors>
	| HttpError<number, unknown>
	| NetworkError
	| TimeoutError
	| AbortError
	| ValidationError
	| ParseError
	| SizeLimitError;

type HttpErrorFor<E, S extends number> =
	[Extract<E, HttpError<S, any>>] extends [never] ? HttpError<S, unknown> : Extract<E, HttpError<S, any>>;

/**
 * Type guard for HTTP errors. With a status it narrows the body to the declared type:
 * ```ts
 * if (isHttpError(error, 404)) error.body // ← NotFound
 * ```
 */
export function isHttpError<E, S extends number>(error: E, status: S): error is HttpErrorFor<E, S> & E;
export function isHttpError<E>(error: E): error is Extract<E, HttpError<any, any>> & E;
export function isHttpError(error: unknown, status?: number): boolean {
	return error instanceof HttpError && (status === undefined || error.status === status);
}
