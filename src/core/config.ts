import type { AuthStrategy } from "../auth/types";
import type { EndpointError } from "../errors";
import type { Middleware } from "../middleware";
import type { RetryListener, RetryOptions } from "../retry";
import type { Schema } from "../schema";
import type { FetchLike, MaybePromise, QueryObject, RequestContext, RequestInitExtras, ResponseType } from "../types";
import type { QuerySerializer } from "../utils/query";

export type OnRequestHook = (ctx: RequestContext) => MaybePromise<void>;
/** Return a `Response` to replace the received one */
export type OnResponseHook = (response: Response, ctx: RequestContext) => MaybePromise<Response | void>;
/** Observe failures. Throwing from the hook replaces the error. */
export type OnErrorHook = (error: EndpointError, ctx: RequestContext | undefined) => MaybePromise<void>;
export type OnRetryHook = RetryListener;

export interface Hooks {
	readonly onRequest: readonly OnRequestHook[];
	readonly onResponse: readonly OnResponseHook[];
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
}
