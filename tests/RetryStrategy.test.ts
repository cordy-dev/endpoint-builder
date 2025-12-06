import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExponentialRetryStrategy } from "../src/retry/ExponentialRetryStrategy";
import type { RetryContext } from "../src/retry/RetryStrategy";

describe("JitteredExponentialBackoffRetryStrategy", () => {
	describe("shouldRetry", () => {
		it("should return true for network errors (missing response)", () => {
			const strategy = new ExponentialRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});

		it("should return true for 5xx errors", () => {
			const strategy = new ExponentialRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 500 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});

		it("should return true for 429 (too many requests)", () => {
			const strategy = new ExponentialRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 429 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});

		it("should return false for successful responses", () => {
			const strategy = new ExponentialRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 200 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});

		it("should return false for 4xx errors (except 429)", () => {
			const strategy = new ExponentialRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 404 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});

		it("should return false if maximum number of attempts is reached", () => {
			const strategy = new ExponentialRetryStrategy({ maxAttempts: 3 });
			const ctx: RetryContext = {
				attempt: 3,
				response: new Response(null, { status: 500 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});

		it("should retry on custom status codes", () => {
			const strategy = new ExponentialRetryStrategy({ retryStatusCodes: [418, 503] });
			const ctx418: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 418 }),
				config: { url: "test", method: "GET" as const }
			};
			const ctx500: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 500 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx418)).toBe(true);
			expect(strategy.shouldRetry(ctx500)).toBe(false); // Not in custom list
		});

		it("should not retry on network errors if disabled", () => {
			const strategy = new ExponentialRetryStrategy({ retryOnNetworkError: false });
			const ctx: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});
	});

	describe("nextDelay", () => {
		beforeEach(() => {
			// Mock Math.random for predictable results
			vi.spyOn(Math, "random").mockReturnValue(0.5);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("should return the correct delay for the first attempt", () => {
			const strategy = new ExponentialRetryStrategy({ maxAttempts: 3, baseDelay: 300 });
			const ctx: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};

			// base = 300, attempt = 1
			// exp = min(300 * 2^0, 10000) = 300
			// jittered = 300/2 + 0.5 * (300/2) = 150 + 75 = 225
			expect(strategy.nextDelay(ctx)).toBe(225);
		});

		it("should return exponentially increasing delay", () => {
			const strategy = new ExponentialRetryStrategy({ maxAttempts: 3, baseDelay: 300 });
			const ctx1: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};
			const ctx2: RetryContext = {
				attempt: 2,
				config: { url: "test", method: "GET" as const }
			};
			const ctx3: RetryContext = {
				attempt: 3,
				config: { url: "test", method: "GET" as const }
			};

			// First attempt: base = 300, jittered = 225
			const delay1 = strategy.nextDelay(ctx1);

			// Second attempt: 300 * 2^1 = 600, jittered = 450
			const delay2 = strategy.nextDelay(ctx2);

			// Third attempt: 300 * 2^2 = 1200, jittered = 900
			const delay3 = strategy.nextDelay(ctx3);

			expect(delay1).toBe(225);
			expect(delay2).toBe(450);
			expect(delay3).toBe(900);
			expect(delay2).toBeGreaterThan(delay1);
			expect(delay3).toBeGreaterThan(delay2);
		});

		it("should limit the maximum delay", () => {
			const maxDelay = 1000;
			const strategy = new ExponentialRetryStrategy({ maxAttempts: 5, baseDelay: 300, maxDelay });
			const ctx: RetryContext = {
				attempt: 5, // Large value to exceed maxDelay
				config: { url: "test", method: "GET" as const }
			};

			// base = 300, attempt = 5
			// exp = min(300 * 2^4 = 4800, 1000) = 1000
			// jittered = 1000/2 + 0.5 * (1000/2) = 500 + 250 = 750
			expect(strategy.nextDelay(ctx)).toBe(750);
		});

		it("should respect Retry-After header with seconds", () => {
			const strategy = new ExponentialRetryStrategy({ respectRetryAfter: true, maxDelay: 60000 });
			const response = new Response(null, {
				status: 429,
				headers: { "Retry-After": "5" }
			});
			const ctx: RetryContext = {
				attempt: 1,
				response,
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.nextDelay(ctx)).toBe(5000); // 5 seconds = 5000ms
		});

		it("should cap Retry-After to maxDelay", () => {
			const strategy = new ExponentialRetryStrategy({ respectRetryAfter: true, maxDelay: 2000 });
			const response = new Response(null, {
				status: 429,
				headers: { "Retry-After": "10" }
			});
			const ctx: RetryContext = {
				attempt: 1,
				response,
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.nextDelay(ctx)).toBe(2000); // Capped to maxDelay
		});
	});
});
