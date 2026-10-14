import { AbortError, type ErrorRequest } from "../errors";
import { errorRequest } from "../utils/url";
import type { Middleware } from "./index";

export interface RateLimit {
	/** Requests allowed in each window */
	requests: number;
	/** Window length in ms */
	per: number;
}

export interface LimiterOptions {
	/** Max requests waiting for response headers at the same time */
	concurrency?: number | undefined;
	/** Max requests started per time window (sliding window) */
	rateLimit?: RateLimit | undefined;
}

interface Waiter {
	resolve: (release: () => void) => void;
	reject: (error: unknown) => void;
	signal: AbortSignal | undefined;
	onAbort: (() => void) | undefined;
}

/** FIFO queue that enforces a concurrency cap and a sliding-window rate limit. Waiting requests can be aborted. */
export class Limiter {
	readonly #concurrency: number;
	readonly #rate: RateLimit | undefined;
	readonly #queue: Waiter[] = [];
	readonly #starts: number[] = [];
	#active = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: LimiterOptions) {
		const { concurrency, rateLimit } = options;
		if (concurrency !== undefined && !(concurrency >= 1)) throw new RangeError("concurrency must be at least 1");
		if (rateLimit && (!(rateLimit.requests >= 1) || !(rateLimit.per > 0))) {
			throw new RangeError("rateLimit needs requests >= 1 and per > 0");
		}
		this.#concurrency = concurrency ?? Infinity;
		this.#rate = rateLimit;
	}

	/** Wait for a free slot. Call the returned function when the request got its response headers. */
	acquire(signal: AbortSignal | undefined, request: ErrorRequest): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(new AbortError(request, signal.reason));
		return new Promise((resolve, reject) => {
			const waiter: Waiter = { resolve, reject, signal, onAbort: undefined };
			if (signal) {
				waiter.onAbort = () => {
					const index = this.#queue.indexOf(waiter);
					if (index !== -1) this.#queue.splice(index, 1);
					reject(new AbortError(request, signal.reason));
				};
				signal.addEventListener("abort", waiter.onAbort, { once: true });
			}
			this.#queue.push(waiter);
			this.#pump();
		});
	}

	#pump(): void {
		while (this.#queue.length > 0 && this.#active < this.#concurrency) {
			if (this.#rate) {
				const now = Date.now();
				while (this.#starts.length > 0 && this.#starts[0]! <= now - this.#rate.per) this.#starts.shift();
				if (this.#starts.length >= this.#rate.requests) {
					this.#wake(this.#starts[0]! + this.#rate.per - now);
					return;
				}
				this.#starts.push(now);
			}
			const waiter = this.#queue.shift()!;
			if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
			this.#active++;
			let released = false;
			waiter.resolve(() => {
				if (released) return;
				released = true;
				this.#active--;
				this.#pump();
			});
		}
	}

	#wake(ms: number): void {
		if (this.#timer) return;
		this.#timer = setTimeout(
			() => {
				this.#timer = undefined;
				this.#pump();
			},
			Math.max(ms, 1),
		);
	}
}

export function createLimiter(options: LimiterOptions): Limiter | undefined {
	return options.concurrency === undefined && options.rateLimit === undefined ? undefined : new Limiter(options);
}

/** Holds a slot while a request waits for its response headers. Streams and bodies read later are not counted. */
export function limitMiddleware(limiter: Limiter): Middleware {
	return async (ctx, next) => {
		const release = await limiter.acquire(ctx.signal, errorRequest(ctx));
		try {
			return await next(ctx);
		} finally {
			release();
		}
	};
}
