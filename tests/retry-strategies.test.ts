import { describe, expect, test } from "vitest";

import type { HttpError } from "../src/core/types";
import {
	CustomRetryStrategy,
	ExponentialBackoffRetryStrategy,
	FixedDelayRetryStrategy,
	JitteredExponentialBackoffRetryStrategy,
	LinearBackoffRetryStrategy,
	NoRetryStrategy
} from "../src/retry-strategies";

describe("Retry Strategies", () => {
	const createHttpError = (status: number): HttpError => ({
		name: "HttpError",
		message: `HTTP Error ${status}`,
		config: { url: "https://api.example.com", method: "GET" },
		status
	});

	describe("FixedDelayRetryStrategy", () => {
		test("should calculate fixed delay", () => {
			const strategy = new FixedDelayRetryStrategy(3, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(1000);
			expect(strategy.calculateDelay(2, error)).toBe(1000);
		});

		test("should retry on 5xx errors", () => {
			const strategy = new FixedDelayRetryStrategy(3, 1000);

			expect(strategy.shouldRetry(createHttpError(500))).toBe(true);
			expect(strategy.shouldRetry(createHttpError(502))).toBe(true);
			expect(strategy.shouldRetry(createHttpError(503))).toBe(true);
		});

		test("should not retry on 4xx errors", () => {
			const strategy = new FixedDelayRetryStrategy(3, 1000);

			expect(strategy.shouldRetry(createHttpError(400))).toBe(false);
			expect(strategy.shouldRetry(createHttpError(404))).toBe(false);
		});

		test("should return null when max attempts reached", () => {
			const strategy = new FixedDelayRetryStrategy(2, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(1000);
			expect(strategy.calculateDelay(2, error)).toBeNull(); // Max attempts reached
		});

		test("should retry on network errors (status 0)", () => {
			const strategy = new FixedDelayRetryStrategy(3, 1000);
			const networkError = createHttpError(0); // Network error

			expect(strategy.shouldRetry(networkError)).toBe(true);
		});
	});

	describe("ExponentialBackoffRetryStrategy", () => {
		test("should calculate exponential backoff delay", () => {
			const strategy = new ExponentialBackoffRetryStrategy(3, 1000, 30000, 2);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000); // base * 2^0
			expect(strategy.calculateDelay(1, error)).toBe(2000); // base * 2^1
			expect(strategy.calculateDelay(2, error)).toBe(4000); // base * 2^2
		});

		test("should respect max delay", () => {
			const strategy = new ExponentialBackoffRetryStrategy(5, 1000, 3000, 2);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(2000);
			expect(strategy.calculateDelay(2, error)).toBe(3000); // Capped at maxDelay
			expect(strategy.calculateDelay(3, error)).toBe(3000); // Capped at maxDelay
		});

		test("should use default multiplier of 2", () => {
			const strategy = new ExponentialBackoffRetryStrategy(3, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(1, error)).toBe(2000); // 1000 * 2^1
		});

		test("should retry appropriately", () => {
			const strategy = new ExponentialBackoffRetryStrategy(3, 1000);

			expect(strategy.shouldRetry(createHttpError(500))).toBe(true);
			expect(strategy.shouldRetry(createHttpError(429))).toBe(true); // Rate limit
			expect(strategy.shouldRetry(createHttpError(400))).toBe(false); // Client error
		});

		test("should return null when max attempts reached", () => {
			const strategy = new ExponentialBackoffRetryStrategy(2, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(2000);
			expect(strategy.calculateDelay(2, error)).toBeNull(); // Max attempts reached
		});
	});

	describe("JitteredExponentialBackoffRetryStrategy", () => {
		test("should calculate jittered delay within expected range", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(3, 1000, 30000, 2, 0.5);
			const error = createHttpError(500);

			// For attempt 0: base = 1000, jitter range = [500, 1500]
			const delay0 = strategy.calculateDelay(0, error);
			expect(delay0).toBeGreaterThanOrEqual(500);
			expect(delay0).toBeLessThanOrEqual(1500);

			// For attempt 1: base = 2000, jitter range = [1000, 3000]
			const delay1 = strategy.calculateDelay(1, error);
			expect(delay1).toBeGreaterThanOrEqual(1000);
			expect(delay1).toBeLessThanOrEqual(3000);
		});

		test("should use default jitter factor of 0.1", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(3, 1000, 30000, 2);
			const error = createHttpError(500);

			// For attempt 1: base = 2000, jitter range = [1800, 2200]
			const delay = strategy.calculateDelay(1, error);
			expect(delay).toBeGreaterThanOrEqual(1800);
			expect(delay).toBeLessThanOrEqual(2200);
		});

		test("should respect max delay with jitter", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(5, 1000, 2500, 2, 0.5);
			const error = createHttpError(500);

			// Even with jitter, should not exceed maxDelay * 1.5 (with max jitter)
			const delay = strategy.calculateDelay(3, error);
			expect(delay).toBeLessThanOrEqual(3750); // 2500 * 1.5
		});
	});

	describe("LinearBackoffRetryStrategy", () => {
		test("should calculate linear delay", () => {
			const strategy = new LinearBackoffRetryStrategy(4, 1000, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);  // 1000 + (0 * 1000)
			expect(strategy.calculateDelay(1, error)).toBe(2000);  // 1000 + (1 * 1000)
			expect(strategy.calculateDelay(2, error)).toBe(3000);  // 1000 + (2 * 1000)
			expect(strategy.calculateDelay(3, error)).toBe(4000);  // 1000 + (3 * 1000)
		});

		test("should calculate incrementally increasing delay", () => {
			const strategy = new LinearBackoffRetryStrategy(5, 2000, 1500);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(2000);  // 2000 + (0 * 1500)
			expect(strategy.calculateDelay(1, error)).toBe(3500);  // 2000 + (1 * 1500)
			expect(strategy.calculateDelay(2, error)).toBe(5000);  // 2000 + (2 * 1500)
			expect(strategy.calculateDelay(3, error)).toBe(6500);  // 2000 + (3 * 1500)
		});

		test("should return null when max attempts reached", () => {
			const strategy = new LinearBackoffRetryStrategy(2, 1000, 1000);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(2000);
			expect(strategy.calculateDelay(2, error)).toBeNull(); // Max attempts reached
		});
	});

	describe("CustomRetryStrategy", () => {
		test("should use custom delay and retry logic", () => {
			const customDelay = (attempt: number, _error: HttpError) => attempt * 333; // Custom delay formula
			const customShouldRetry = (error: HttpError) => error.status === 418; // Only retry for teapot errors

			const strategy = new CustomRetryStrategy(3, customDelay, customShouldRetry);
			const error418 = createHttpError(418);
			const error500 = createHttpError(500);

			expect(strategy.shouldRetry(error418)).toBe(true);
			expect(strategy.shouldRetry(error500)).toBe(false);
			expect(strategy.calculateDelay(1, error418)).toBe(333);
			expect(strategy.calculateDelay(2, error418)).toBe(666);
		});

		test("should respect max attempts", () => {
			const customDelay = () => 1000;
			const customShouldRetry = () => true;

			const strategy = new CustomRetryStrategy(2, customDelay, customShouldRetry);
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBe(1000);
			expect(strategy.calculateDelay(1, error)).toBe(1000);
			expect(strategy.calculateDelay(2, error)).toBeNull(); // Max attempts reached
		});

		test("should allow complex retry logic", () => {
			const customShouldRetry = (error: HttpError) => {
				return error.status === 429 || error.status === 503 || error.status === 0; // Rate limit, service unavailable, or network error
			};
			const customDelay = (attempt: number) => 100 * Math.pow(3, attempt); // Custom exponential

			const strategy = new CustomRetryStrategy(3, customDelay, customShouldRetry);

			expect(strategy.shouldRetry(createHttpError(429))).toBe(true); // Rate limit
			expect(strategy.shouldRetry(createHttpError(503))).toBe(true); // Service unavailable
			expect(strategy.shouldRetry(createHttpError(0))).toBe(true);   // Network error
			expect(strategy.shouldRetry(createHttpError(404))).toBe(false); // Not found
			expect(strategy.calculateDelay(0, createHttpError(429))).toBe(100); // 100 * 3^0
			expect(strategy.calculateDelay(1, createHttpError(429))).toBe(300); // 100 * 3^1
		});
	});

	describe("NoRetryStrategy", () => {
		test("should never retry", () => {
			const strategy = new NoRetryStrategy();

			expect(strategy.shouldRetry(createHttpError(500))).toBe(false);
			expect(strategy.shouldRetry(createHttpError(502))).toBe(false);
			expect(strategy.shouldRetry(createHttpError(429))).toBe(false);
		});

		test("should return null for all delay calculations", () => {
			const strategy = new NoRetryStrategy();
			const error = createHttpError(500);

			expect(strategy.calculateDelay(0, error)).toBeNull();
			expect(strategy.calculateDelay(1, error)).toBeNull();
			expect(strategy.calculateDelay(100, error)).toBeNull();
		});
	});

	describe("Integration Tests", () => {
		test("should handle network timeout errors", () => {
			const networkError: HttpError = {
				name: "TimeoutError",
				message: "Request timeout",
				config: { url: "https://api.example.com", method: "GET" },
				code: "ETIMEDOUT",
				status: 0 // Network error
			};

			const strategies = [
				new FixedDelayRetryStrategy(3, 1000),
				new ExponentialBackoffRetryStrategy(3, 1000),
				new LinearBackoffRetryStrategy(3, 1000)
			];

			strategies.forEach(strategy => {
				expect(strategy.shouldRetry(networkError)).toBe(true);
				expect(strategy.calculateDelay(0, networkError)).toBeGreaterThan(0);
				expect(strategy.calculateDelay(3, networkError)).toBeNull(); // Max attempts reached
			});
		});

		test("should handle different error types consistently", () => {
			const errors = [
				createHttpError(500), // Server error
				createHttpError(502), // Bad gateway
				createHttpError(503), // Service unavailable
				createHttpError(400), // Client error - should not retry
				createHttpError(404), // Not found - should not retry
			];

			const strategy = new FixedDelayRetryStrategy(3, 1000);

			expect(strategy.shouldRetry(errors[0]!)).toBe(true);  // 500
			expect(strategy.shouldRetry(errors[1]!)).toBe(true);  // 502
			expect(strategy.shouldRetry(errors[2]!)).toBe(true);  // 503
			expect(strategy.shouldRetry(errors[3]!)).toBe(false); // 400
			expect(strategy.shouldRetry(errors[4]!)).toBe(false); // 404
		});

		test("should calculate reasonable delays", () => {
			const strategies = [
				new FixedDelayRetryStrategy(3, 1000),
				new ExponentialBackoffRetryStrategy(3, 1000),
				new LinearBackoffRetryStrategy(3, 1000),
			];

			const error = createHttpError(500);

			strategies.forEach(strategy => {
				// All delays should be reasonable (not negative, not extremely large)
				for (let attempt = 0; attempt < 3; attempt++) {
					const delay = strategy.calculateDelay(attempt, error);
					expect(delay).toBeGreaterThan(0);
					expect(delay).toBeLessThan(60000); // Less than 1 minute
				}
			});
		});

		test("should all respect max attempts", () => {
			const maxAttempts = 2;
			const strategies = [
				new FixedDelayRetryStrategy(maxAttempts, 1000),
				new ExponentialBackoffRetryStrategy(maxAttempts, 1000),
				new LinearBackoffRetryStrategy(maxAttempts, 1000),
			];

			const error = createHttpError(500);

			strategies.forEach(strategy => {
				expect(strategy.calculateDelay(0, error)).toBeGreaterThan(0);
				expect(strategy.calculateDelay(1, error)).toBeGreaterThan(0);
				expect(strategy.calculateDelay(maxAttempts, error)).toBeNull(); // Max attempts reached
			});
		});
	});
});
