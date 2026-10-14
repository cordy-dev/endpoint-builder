import { AbortError, EndpointError, NetworkError, TimeoutError } from "../errors";
import type { Next } from "../middleware";
import type { FetchLike, RequestContext } from "../types";
import { isStream } from "../utils/body";
import { errorRequest } from "../utils/url";

/**
 * Pending per-attempt timers keyed by response. The timeout keeps running while the body
 * is being read and is released once the body is consumed (or discarded).
 */
const pending = new WeakMap<Response, () => void>();

/** Stop the timeout attached to a response (no-op for unknown responses) */
export function releaseResponse(response: Response): void {
	const release = pending.get(response);
	if (release) {
		pending.delete(response);
		release();
	}
}

const hasSignalAny = typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function";

/**
 * Combine the user signal with the timeout controller. `AbortSignal.any` keeps the user signal
 * wired to the response body after the timeout was released (important for streams); the fallback
 * listener is removed on release.
 */
function linkSignals(
	user: AbortSignal | undefined,
	controller: AbortController,
): { signal: AbortSignal; dispose: () => void } {
	if (!user) return { signal: controller.signal, dispose: () => undefined };
	if (hasSignalAny) return { signal: AbortSignal.any([user, controller.signal]), dispose: () => undefined };
	const onAbort = () => controller.abort(user.reason);
	user.addEventListener("abort", onAbort, { once: true });
	return { signal: controller.signal, dispose: () => user.removeEventListener("abort", onAbort) };
}

/** Terminal pipeline handler: performs the actual `fetch` with timeout + abort handling */
export function createTransport(fetchImpl: FetchLike | undefined): Next {
	return async (ctx) => {
		const request = errorRequest(ctx);
		const userSignal = ctx.signal;
		if (userSignal?.aborted) throw new AbortError(request, userSignal.reason);

		const doFetch = fetchImpl ?? globalThis.fetch;
		const timeout = ctx.timeout;
		const init: RequestInit & { duplex?: "half" } = {
			...ctx.init,
			method: ctx.method,
			headers: ctx.headers,
			body: ctx.body ?? null,
		};
		if (isStream(ctx.body)) init.duplex = "half";

		// Fast path: nothing to cancel
		if (timeout === undefined || timeout <= 0 || !Number.isFinite(timeout)) {
			if (userSignal) init.signal = userSignal;
			try {
				return await doFetch(ctx.url, init);
			} catch (error) {
				throw toTransportError(error, ctx, false);
			}
		}

		const controller = new AbortController();
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			controller.abort(new TimeoutError(timeout, request));
		}, timeout);
		const linked = linkSignals(userSignal, controller);
		const cleanup = () => {
			clearTimeout(timer);
			linked.dispose();
		};
		init.signal = linked.signal;

		try {
			const response = await doFetch(ctx.url, init);
			if (response.body) pending.set(response, cleanup);
			else cleanup();
			return response;
		} catch (error) {
			cleanup();
			throw toTransportError(error, ctx, timedOut);
		}
	};
}

export function toTransportError(error: unknown, ctx: RequestContext, timedOut: boolean): EndpointError {
	const request = errorRequest(ctx);
	if (timedOut) return new TimeoutError(ctx.timeout ?? 0, request);
	if (error instanceof EndpointError) return error;
	if (ctx.signal?.aborted) return new AbortError(request, ctx.signal.reason);
	const message = error instanceof Error ? error.message : String(error);
	return new NetworkError(`Network request failed: ${message} (${request.method} ${request.url})`, request, error);
}
