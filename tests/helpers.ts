import { vi } from "vitest";

export interface RecordedCall {
	url: string;
	method: string;
	headers: Headers;
	body: BodyInit | null | undefined;
	init: RequestInit;
}

type Responder = (call: RecordedCall, index: number) => Response | Promise<Response>;

export function json(data: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(data), {
		...init,
		headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
	});
}

/**
 * Fake fetch: answers with `responders` in order (the last one repeats) and records every call.
 */
export function mockFetch(...responders: (Responder | Response)[]) {
	const calls: RecordedCall[] = [];
	const fn = vi.fn(async (url: string, init: RequestInit) => {
		const call: RecordedCall = {
			url,
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body: init.body,
			init,
		};
		calls.push(call);
		const index = calls.length - 1;
		const responder = responders[Math.min(index, responders.length - 1)];
		if (!responder) return json({});
		if (responder instanceof Response) return responder.clone();
		return responder(call, index);
	});
	return Object.assign(fn, { calls });
}

/** fetch that waits for the abort signal (or never resolves) */
export function hangingFetch() {
	return vi.fn(
		(_url: string, init: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener("abort", () =>
					reject(init.signal!.reason ?? new DOMException("Aborted", "AbortError")),
				);
			}),
	);
}

export async function readBody(body: BodyInit | null | undefined): Promise<string> {
	if (body === null || body === undefined) return "";
	return new Response(body).text();
}

/** A streaming response delivered chunk by chunk (optionally spaced by `delayMs`) */
export function chunked(chunks: (string | Uint8Array)[], init: ResponseInit = {}, delayMs = 0): Response {
	const encoder = new TextEncoder();
	let index = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (index >= chunks.length) return controller.close();
			const chunk = chunks[index++]!;
			controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
		},
	});
	return new Response(body, init);
}

export const sseResponse = (chunks: (string | Uint8Array)[], delayMs = 0) =>
	chunked(chunks, { headers: { "content-type": "text/event-stream" } }, delayMs);

export const ndjsonResponse = (chunks: (string | Uint8Array)[], delayMs = 0) =>
	chunked(chunks, { headers: { "content-type": "application/x-ndjson" } }, delayMs);
