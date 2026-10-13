import type { AuthStrategy } from "../auth/types";
import type { Middleware } from "../middleware";
import type { Limiter, RateLimit } from "../middleware/limit";
import type { RetryOptions } from "../retry";
import type { Schema } from "../schema";
import type { FetchLike, OnErrorHook, OnRequestHook, OnResponseHook, OnRetryHook, OnSuccessHook, QueryObject, RequestInitExtras, ResponseType } from "../types";
import type { QuerySerializer } from "../utils/query";

export type { OnErrorHook, OnRequestHook, OnResponseHook, OnRetryHook, OnSuccessHook } from "../types";

export interface Hooks {
	readonly onRequest: readonly OnRequestHook[];
	readonly onResponse: readonly OnResponseHook[];
	readonly onSuccess: readonly OnSuccessHook[];
	readonly onError: readonly OnErrorHook[];
	readonly onRetry: readonly OnRetryHook[];
}

export type Unwrap = (body: any) => unknown;

/** Fully resolved, immutable client configuration */
export interface ClientConfig {
	readonly baseUrl: string;
	readonly headers: Readonly<Record<string, string | null>>;
	readonly query: QueryObject | undefined;
	readonly timeout: number | undefined;
	readonly retry: RetryOptions | false;
	readonly auth: AuthStrategy | false;
	readonly dedupe: boolean;
	readonly fetch: FetchLike | undefined;
	readonly middleware: readonly Middleware[];
	readonly hooks: Hooks;
	readonly unwrap: Unwrap | undefined;
	readonly querySerializer: QuerySerializer;
	readonly errors: Readonly<Record<number, Schema>>;
	readonly init: RequestInitExtras;
	readonly responseType: ResponseType;
	readonly maxResponseBytes: number | undefined;
	readonly concurrency: number | undefined;
	readonly rateLimit: RateLimit | undefined;
	/** Shared by derived clients unless `concurrency` / `rateLimit` change */
	readonly limiter: Limiter | undefined;
}
