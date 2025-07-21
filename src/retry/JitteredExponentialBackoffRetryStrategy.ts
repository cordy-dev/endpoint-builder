import type { RetryContext, RetryStrategy } from "./RetryStrategy";

export class JitteredExponentialBackoffRetryStrategy implements RetryStrategy {
	constructor(
		private maxAttempts = 3,
		private base = 300,
		private maxDelay = 10_000,
	) {}

	shouldRetry(ctx: RetryContext): boolean {
		if (ctx.attempt >= this.maxAttempts) return false;
		const status = ctx.response?.status;
		// network / CORS failure => no response
		if (!ctx.response) return true;
		return status! >= 500 || status === 429;
	}

	nextDelay(ctx: RetryContext): number {
		const exp = Math.min(this.base * 2 ** (ctx.attempt - 1), this.maxDelay);
		return exp / 2 + Math.random() * (exp / 2); // full jitter
	}
}