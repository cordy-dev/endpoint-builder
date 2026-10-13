import { AbortError, type ErrorRequest } from "../errors";

/** Sleep that rejects with `AbortError` as soon as `signal` aborts */
export function sleep(ms: number, signal: AbortSignal | undefined, request?: ErrorRequest): Promise<void> {
	if (signal?.aborted) return Promise.reject(new AbortError(request, signal.reason));
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new AbortError(request, signal?.reason));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
