import { releaseResponse } from "../core/transport";
import { AbortError } from "../errors";
import type { RequestContext } from "../types";
import { errorRequest } from "../utils/url";
import type { Middleware, Next } from "./index";

interface Inflight {
	promise: Promise<Response>;
	controller: AbortController;
	waiters: number;
}

function dedupeKey(ctx: RequestContext): string {
	let key = `${ctx.method} ${ctx.url}`;
	ctx.headers.forEach((value, name) => { key += `\n${name}:${value}`; });
	return key;
}

/**
 * Collapse identical concurrent GET/HEAD requests into one network call.
 * Every caller receives its own `Response` clone. The shared request is only
 * cancelled when *all* callers have aborted.
 * Enabled per request via `ctx.dedupe`.
 */
export function dedupeMiddleware(): Middleware {
	const inflight = new Map<string, Inflight>();

	// non-async dispatcher: requests that are not deduped pay no extra promise
	return (ctx, next) => !ctx.dedupe || (ctx.method !== "GET" && ctx.method !== "HEAD") || ctx.body != null
		? next(ctx)
		: shared(ctx, next);

	async function shared(ctx: RequestContext, next: Next): Promise<Response> {
		if (ctx.signal?.aborted) throw new AbortError(errorRequest(ctx), ctx.signal.reason);

		const key = dedupeKey(ctx);
		let entry = inflight.get(key);
		if (!entry) {
			const controller = new AbortController();
			const sharedCtx: RequestContext = { ...ctx, headers: new Headers(ctx.headers), signal: controller.signal, meta: { ...ctx.meta } };
			const created: Inflight = {
				controller,
				waiters: 0,
				promise: next(sharedCtx).then(response => {
					// clones are read independently; the timeout no longer applies to them
					releaseResponse(response);
					return response;
				}),
			};
			created.promise.then(
				() => inflight.delete(key),
				() => inflight.delete(key),
			);
			inflight.set(key, created);
			entry = created;
		}

		const current = entry;
		current.waiters++;
		const signal = ctx.signal;

		return new Promise<Response>((resolve, reject) => {
			let settled = false;
			const onAbort = () => {
				if (settled) return;
				settled = true;
				if (--current.waiters === 0) current.controller.abort(signal?.reason);
				reject(new AbortError(errorRequest(ctx), signal?.reason));
			};
			if (signal?.aborted) return onAbort();
			signal?.addEventListener("abort", onAbort, { once: true });

			current.promise.then(
				response => {
					signal?.removeEventListener("abort", onAbort);
					if (settled) return;
					settled = true;
					current.waiters--;
					resolve(response.clone());
				},
				(error: unknown) => {
					signal?.removeEventListener("abort", onAbort);
					if (settled) return;
					settled = true;
					current.waiters--;
					reject(error instanceof Error ? error : new Error(String(error)));
				},
			);
		});
	}
}
