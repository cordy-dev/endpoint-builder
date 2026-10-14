import { releaseResponse } from "../core/transport";
import { type EndpointError, NetworkError, TimeoutError } from "../errors";
import type { Middleware, Next } from "../middleware";
import type { HttpMethod, MaybePromise, RequestContext } from "../types";
import { isStream } from "../utils/body";
import { discardBody } from "../utils/decode";
import { sleep } from "../utils/signal";
import { errorRequest } from "../utils/url";

export type Backoff = "exponential" | "linear" | "constant" | ((attempt: number) => number);

export interface RetryState {
	/** Attempt that just failed (1 = first try) */
	readonly attempt: number;
	readonly request: RequestContext;
	/** Present when the server answered */
	readonly response?: Response;
	/** Present on network errors / timeouts */
	readonly error?: EndpointError;
}

export interface RetryOptions {
	/** Max number of retries after the first attempt (default `2`) */
	limit?: number;
	/** Methods that may be retried (default: idempotent methods — GET, HEAD, OPTIONS, PUT, DELETE) */
	methods?: readonly HttpMethod[];
	/** Status codes that trigger a retry (default `408, 425, 429, 500, 502, 503, 504`) */
	statusCodes?: readonly number[];
	/** Delay growth (default `exponential`) */
	backoff?: Backoff;
	/** Base delay in ms (default `300`) */
	delay?: number;
	/** Upper bound for computed delays in ms (default `30_000`) */
	maxDelay?: number;
	/** Full jitter on computed delays (default `true`) */
	jitter?: boolean;
	/** Respect `Retry-After`; a number caps the honoured wait in ms (default `true` = capped by `maxDelay`) */
	retryAfter?: boolean | number;
	/** Retry on network failures (default `true`) */
	networkErrors?: boolean;
	/** Retry when the per-attempt timeout elapses (default `true`) */
	timeouts?: boolean;
	/** Custom decision. Return `undefined` to fall back to the default rules. */
	shouldRetry?: (state: RetryState) => MaybePromise<boolean | undefined>;
}

/** `true` → defaults, number → retry limit, `false` → disabled */
export type RetryInput = RetryOptions | number | boolean;

export const IDEMPOTENT_METHODS: readonly HttpMethod[] = ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"];
export const RETRY_STATUS_CODES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

export function normalizeRetry(input: RetryInput | undefined): RetryOptions | false {
	if (input === undefined || input === true) return {};
	if (input === false) return false;
	if (typeof input === "number") return input > 0 ? { limit: input } : false;
	return input;
}

/** Merge per-request retry overrides on top of the client policy */
export function mergeRetry(base: RetryOptions | false, override: RetryInput | undefined): RetryOptions | false {
	if (override === undefined) return base;
	const next = normalizeRetry(override);
	if (next === false) return false;
	return typeof override === "object" || typeof override === "number" ? { ...base, ...next } : base || next;
}

function parseRetryAfter(value: string | null): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function defaultDecision(policy: RetryOptions, state: RetryState): boolean {
	if (!(policy.methods ?? IDEMPOTENT_METHODS).includes(state.request.method)) return false;
	if (state.response) return (policy.statusCodes ?? RETRY_STATUS_CODES).includes(state.response.status);
	if (state.error instanceof TimeoutError) return policy.timeouts ?? true;
	if (state.error instanceof NetworkError) return policy.networkErrors ?? true;
	return false;
}

/** Compute the wait before the next attempt; `undefined` means "give up" (Retry-After too long) */
export function computeDelay(policy: RetryOptions, state: RetryState): number | undefined {
	const maxDelay = policy.maxDelay ?? 30_000;

	if (state.response && policy.retryAfter !== false) {
		const header = parseRetryAfter(state.response.headers.get("retry-after"));
		if (header !== undefined) {
			const cap = typeof policy.retryAfter === "number" ? policy.retryAfter : maxDelay;
			return header <= cap ? header : undefined;
		}
	}

	const base = policy.delay ?? 300;
	const backoff = policy.backoff ?? "exponential";
	const raw =
		typeof backoff === "function"
			? backoff(state.attempt)
			: backoff === "linear"
				? base * state.attempt
				: backoff === "constant"
					? base
					: base * 2 ** (state.attempt - 1);
	const capped = Math.min(raw, maxDelay);
	return policy.jitter === false ? capped : capped / 2 + Math.random() * (capped / 2);
}

export type RetryListener = (state: RetryState & { readonly delay: number }) => MaybePromise<void>;

/** Bodies that can be sent again (streams are consumed by the first attempt) */
function isReplayable(ctx: RequestContext): boolean {
	return !isStream(ctx.body);
}

/** Retry middleware. Reads the effective policy from `ctx.retry`, so it is composed once per client. */
export function retryMiddleware(listeners: readonly RetryListener[] = []): Middleware {
	return (ctx, next) => (ctx.retry && isReplayable(ctx) ? withRetry(ctx.retry, ctx, next) : next(ctx));

	async function withRetry(policy: RetryOptions, ctx: RequestContext, next: Next): Promise<Response> {
		const limit = policy.limit ?? 2;

		for (let attempt = 1; ; attempt++) {
			ctx.attempt = attempt;
			let response: Response | undefined;
			let error: EndpointError | undefined;
			try {
				response = await next(ctx);
				if (response.ok) return response;
			} catch (caught) {
				if (!(caught instanceof NetworkError || caught instanceof TimeoutError)) throw caught;
				error = caught;
			}

			const state: RetryState = response ? { attempt, request: ctx, response } : { attempt, request: ctx, error };
			let retry = attempt <= limit;
			if (retry) {
				const custom = policy.shouldRetry ? await policy.shouldRetry(state) : undefined;
				retry = custom ?? defaultDecision(policy, state);
			}
			const delay = retry ? computeDelay(policy, state) : undefined;
			if (delay === undefined) {
				if (error) throw error;
				return response!;
			}

			if (response) {
				releaseResponse(response);
				discardBody(response);
			}
			for (const listener of listeners) await listener({ ...state, delay });
			if (ctx.hooks) for (const listener of ctx.hooks.onRetry) await listener({ ...state, delay });
			await sleep(delay, ctx.signal, errorRequest(ctx));
		}
	}
}
