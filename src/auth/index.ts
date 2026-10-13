import { releaseResponse } from "../core/transport";
import type { Middleware, Next } from "../middleware";
import type { MaybePromise, RequestContext } from "../types";
import { isStream } from "../utils/body";
import { discardBody } from "../utils/decode";
import { appendQuery } from "../utils/query";
import type { AuthStrategy } from "./types";

export type { AuthStrategy } from "./types";

/** Static value or (async) getter */
export type Credential = string | (() => MaybePromise<string | null | undefined>);

async function resolve(value: Credential): Promise<string | null | undefined> {
	return typeof value === "function" ? value() : value;
}

/** `Authorization: Bearer <token>`. Skipped when the getter returns an empty value. */
export function bearer(token: Credential): AuthStrategy {
	return {
		async apply(ctx) {
			const value = await resolve(token);
			if (value) ctx.headers.set("authorization", `Bearer ${value}`);
		},
	};
}

export interface ApiKeyOptions {
	/** Header name (default `X-API-Key`) */
	header?: string;
	/** Send as query parameter with this name instead of a header */
	query?: string;
}

/** API key in a header (default `X-API-Key`) or query parameter */
export function apiKey(key: Credential, options: ApiKeyOptions = {}): AuthStrategy {
	return {
		async apply(ctx) {
			const value = await resolve(key);
			if (!value) return;
			if (options.query) {
				ctx.url = appendQuery(ctx.url, `${encodeURIComponent(options.query)}=${encodeURIComponent(value)}`);
			} else {
				ctx.headers.set(options.header ?? "x-api-key", value);
			}
		},
	};
}

function base64(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** HTTP Basic auth (UTF-8 safe) */
export function basic(username: string, password: string): AuthStrategy {
	const header = `Basic ${base64(`${username}:${password}`)}`;
	return {
		apply(ctx) {
			ctx.headers.set("authorization", header);
		},
	};
}

export interface RefreshableOptions {
	/** Current access token */
	getToken: () => MaybePromise<string | null | undefined>;
	/**
	 * Obtain new credentials and store them (so the next `getToken()` returns the fresh token).
	 * Concurrent 401s share a single in-flight refresh. Return `false` (or throw) when refresh is impossible.
	 */
	refresh: (ctx: RequestContext) => MaybePromise<boolean | void>;
	/** Trigger condition (default: status 401) */
	shouldRefresh?: (response: Response) => boolean;
	/** Header name (default `Authorization`) */
	header?: string;
	/** Header value prefix (default `Bearer `) */
	scheme?: string;
}

/**
 * Bearer token with automatic, single-flight refresh on 401.
 * Each request is replayed at most once, so a broken refresh can never loop.
 */
export function refreshable(options: RefreshableOptions): AuthStrategy {
	const header = options.header ?? "authorization";
	const scheme = options.scheme ?? "Bearer ";
	let inflight: Promise<boolean> | undefined;

	return {
		async apply(ctx) {
			const token = await options.getToken();
			if (token) ctx.headers.set(header, scheme + token);
		},
		shouldRefresh: options.shouldRefresh ?? (response => response.status === 401),
		refresh(ctx) {
			inflight ??= (async () => {
				try {
					return (await options.refresh(ctx)) !== false;
				} catch {
					return false;
				} finally {
					inflight = undefined;
				}
			})();
			return inflight;
		},
	};
}

/** Auth middleware: applies `ctx.auth` and replays once after a successful refresh */
export function authMiddleware(): Middleware {
	return (ctx, next) => ctx.auth ? withAuth(ctx.auth, ctx, next) : next(ctx);
}

async function withAuth(auth: AuthStrategy, ctx: RequestContext, next: Next): Promise<Response> {
	const response = await attempt(auth, ctx, next);
	if (!auth.refresh || isStream(ctx.body)) return response;

	const shouldRefresh = auth.shouldRefresh ? auth.shouldRefresh(response, ctx) : response.status === 401;
	if (!shouldRefresh || !(await auth.refresh(ctx, response))) return response;

	releaseResponse(response);
	discardBody(response);
	return attempt(auth, ctx, next);
}

/** Apply credentials for one attempt; the URL is restored afterwards so query credentials never pile up or leak into errors */
async function attempt(auth: AuthStrategy, ctx: RequestContext, next: Next): Promise<Response> {
	const url = ctx.url;
	try {
		await auth.apply(ctx);
		return await next(ctx);
	} finally {
		ctx.url = url;
	}
}
