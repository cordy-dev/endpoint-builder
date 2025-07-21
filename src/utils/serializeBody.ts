import type { HttpHeaders } from "../types";

/**
 * Serialize request body based on content type and body type
 * @param body - Request body to serialize
 * @param headers - Request headers to check for Content-Type
 * @returns Serialized body or undefined if body is null/undefined
 */
export function serializeBody<B>(body: B, headers: HttpHeaders): B | string | undefined {
	// Return undefined for null/undefined bodies
	if (body === undefined || body === null) {
		return undefined;
	}

	// Don't transform Web API objects
	if (
		body instanceof FormData ||
		body instanceof Blob ||
		body instanceof ArrayBuffer ||
		body instanceof ReadableStream
	) {
		return body;
	}

	// Check Content-Type header (case-insensitive)
	let contentType: string | undefined;

	// More efficient content-type lookup
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === "content-type") {
			contentType = headers[key] as string;
			break;
		}
	}

	// Send JSON if content-type is application/json or body is an object
	// (but not a Web API object which we already checked above)
	const shouldSendJson = contentType?.includes("application/json") ?? (typeof body === "object");

	return shouldSendJson ? JSON.stringify(body) : body;
}