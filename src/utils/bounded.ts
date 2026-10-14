export interface BoundedBody {
	readonly bytes: Uint8Array;
	/** The body was longer than the limit; `bytes` holds the part that was read */
	readonly truncated: boolean;
	/** Content-Length announced by the server, when it already exceeded the limit */
	readonly declared: number | undefined;
}

/**
 * Read at most `max` bytes of a response body. A body announced as too large (Content-Length)
 * is not read at all, and reading stops as soon as the limit is exceeded, so memory stays bounded.
 */
export async function readBounded(response: Response, max: number): Promise<BoundedBody> {
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && length > max) {
		void response.body?.cancel().catch(() => undefined);
		return { bytes: new Uint8Array(0), truncated: true, declared: length };
	}

	const reader = response.body?.getReader();
	if (!reader) return { bytes: new Uint8Array(0), truncated: false, declared: undefined };

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (total + value.length > max) {
			chunks.push(value.subarray(0, max - total));
			total = max;
			void reader.cancel().catch(() => undefined);
			return { bytes: concat(chunks, total), truncated: true, declared: undefined };
		}
		chunks.push(value);
		total += value.length;
	}
	return { bytes: concat(chunks, total), truncated: false, declared: undefined };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
	if (chunks.length === 1) return chunks[0]!;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/** A fresh `Response` carrying already-read bytes, with the status and headers of the original */
export function withBytes(response: Response, bytes: Uint8Array): Response {
	return new Response(bytes as BodyInit, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
