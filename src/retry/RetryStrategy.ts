import type { HttpError, HttpRequestConfig } from "../types";

export interface RetryContext {
  attempt: number;            // starts at 1
  error?: HttpError;
  response?: Response;
  config: HttpRequestConfig;  // final cfg used for fetch
}

export interface RetryStrategy {
  shouldRetry(ctx: RetryContext): boolean | Promise<boolean>;
  nextDelay(ctx: RetryContext): number | Promise<number>; // milliseconds
}