import type { MaybePromise, RequestContext } from "../types";

/**
 * Authentication strategy.
 * `apply` runs before every attempt (so refreshed credentials are picked up on retries).
 */
export interface AuthStrategy {
	/** Attach credentials to the outgoing request (headers, query, ...) */
	apply(ctx: RequestContext): MaybePromise<void>;
	/** Should this response trigger `refresh`? (default: status 401) */
	shouldRefresh?(response: Response, ctx: RequestContext): boolean;
	/** Renew credentials. Return `true` to replay the request once. */
	refresh?(ctx: RequestContext, response: Response): MaybePromise<boolean>;
}
