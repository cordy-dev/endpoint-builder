import type { RequestContext } from "../types";

/** Calls the rest of the pipeline */
export type Next = (ctx: RequestContext) => Promise<Response>;

/**
 * Pipeline handler, similar to `DelegatingHandler` in .NET or Koa middleware.
 * Can inspect/mutate the request, short-circuit with its own `Response`, or post-process the response.
 *
 * ```ts
 * const timing: Middleware = async (ctx, next) => {
 *   const started = performance.now();
 *   try { return await next(ctx); }
 *   finally { console.log(ctx.method, ctx.url, performance.now() - started); }
 * };
 * ```
 */
export type Middleware = (ctx: RequestContext, next: Next) => Promise<Response>;

/** Compose middleware (outermost first) around a terminal handler. Done once per client. */
export function compose(middleware: readonly Middleware[], terminal: Next): Next {
	let next = terminal;
	for (let i = middleware.length - 1; i >= 0; i--) {
		const current = middleware[i]!;
		const inner = next;
		next = (ctx) => current(ctx, inner);
	}
	return next;
}
