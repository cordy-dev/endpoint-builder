import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JitteredExponentialBackoffRetryStrategy } from "../src/retry/JitteredExponentialBackoffRetryStrategy";
import type { RetryContext } from "../src/retry/RetryStrategy";

describe("JitteredExponentialBackoffRetryStrategy", () => {
	describe("shouldRetry", () => {
		it("должен возвращать true для сетевых ошибок (отсутствие response)", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});		it("должен возвращать true для 5xx ошибок", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 500 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});

		it("должен возвращать true для 429 (слишком много запросов)", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 429 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(true);
		});		it("должен возвращать false для успешных ответов", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 200 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});

		it("должен возвращать false для 4xx ошибок (кроме 429)", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy();
			const ctx: RetryContext = {
				attempt: 1,
				response: new Response(null, { status: 404 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});

		it("должен возвращать false, если достигнуто максимальное количество попыток", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(3);
			const ctx: RetryContext = {
				attempt: 3,
				response: new Response(null, { status: 500 }),
				config: { url: "test", method: "GET" as const }
			};

			expect(strategy.shouldRetry(ctx)).toBe(false);
		});
	});

	describe("nextDelay", () => {
		beforeEach(() => {
			// Мокаем Math.random для предсказуемых результатов
			vi.spyOn(Math, "random").mockReturnValue(0.5);
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("должен возвращать правильную задержку для первой попытки", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(3, 300);
			const ctx: RetryContext = {
				attempt: 1,
				config: { url: "test", method: "GET" as const }
			};

			// base = 300, attempt = 1
			// exp = min(300 * 2^0, 10000) = 300
			// jittered = 300/2 + 0.5 * (300/2) = 150 + 75 = 225
			expect(strategy.nextDelay(ctx)).toBe(225);
		});

		it("должен возвращать экспоненциально увеличивающуюся задержку", () => {
			const strategy = new JitteredExponentialBackoffRetryStrategy(3, 300);
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

			// Первая попытка: base = 300, jittered = 225
			const delay1 = strategy.nextDelay(ctx1);

			// Вторая попытка: 300 * 2^1 = 600, jittered = 450
			const delay2 = strategy.nextDelay(ctx2);

			// Третья попытка: 300 * 2^2 = 1200, jittered = 900
			const delay3 = strategy.nextDelay(ctx3);

			expect(delay1).toBe(225);
			expect(delay2).toBe(450);
			expect(delay3).toBe(900);
			expect(delay2).toBeGreaterThan(delay1);
			expect(delay3).toBeGreaterThan(delay2);
		});

		it("должен ограничивать максимальную задержку", () => {
			const maxDelay = 1000;
			const strategy = new JitteredExponentialBackoffRetryStrategy(5, 300, maxDelay);
			const ctx: RetryContext = {
				attempt: 5, // Большое значение, чтобы превысить maxDelay
				config: { url: "test", method: "GET" as const }
			};

			// base = 300, attempt = 5
			// exp = min(300 * 2^4 = 4800, 1000) = 1000
			// jittered = 1000/2 + 0.5 * (1000/2) = 500 + 250 = 750
			expect(strategy.nextDelay(ctx)).toBe(750);
		});
	});
});
