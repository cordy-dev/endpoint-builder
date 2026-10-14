import { type ErrorRequest, ParseError } from "../errors";
import type { HttpMethod, ResponseType } from "../types";

const JSON_RE = /[/+]json\b/i;
const TEXT_RE = /^text\/|[/+]xml\b|javascript|x-www-form-urlencoded/i;

/** True when the response cannot carry a body */
export function isBodyless(response: Response, method: HttpMethod): boolean {
	return (
		method === "HEAD" ||
		response.status === 204 ||
		response.status === 205 ||
		response.status === 304 ||
		response.headers.get("content-length") === "0" ||
		response.body === null
	);
}

function parseJson(text: string, request: ErrorRequest): unknown {
	if (text === "") return undefined;
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new ParseError(`Malformed JSON response (${request.method} ${request.url})`, text, request, cause);
	}
}

/**
 * Read the response body according to `responseType`.
 * `auto` → JSON for `*\/json` and `*+json`, text for textual types or a missing Content-Type, Blob otherwise.
 */
export async function decodeBody(response: Response, type: ResponseType, request: ErrorRequest): Promise<unknown> {
	if (type === "stream") return response.body;
	if (isBodyless(response, request.method)) return undefined;

	switch (type) {
		case "json":
			return parseJson(await response.text(), request);
		case "text":
			return response.text();
		case "blob":
			return response.blob();
		case "arrayBuffer":
			return response.arrayBuffer();
		case "formData":
			return response.formData();
	}

	const contentType = response.headers.get("content-type");
	if (!contentType) {
		return response.text();
	}
	if (JSON_RE.test(contentType)) return parseJson(await response.text(), request);
	if (TEXT_RE.test(contentType)) return response.text();
	return response.blob();
}

/** Best-effort decoding of an error body: never throws, falls back to raw text */
export async function decodeErrorBody(response: Response, request: ErrorRequest): Promise<unknown> {
	if (isBodyless(response, request.method)) return undefined;
	let text: string;
	try {
		text = await response.text();
	} catch {
		return undefined;
	}
	if (text === "") return undefined;
	const contentType = response.headers.get("content-type") ?? "";
	if (JSON_RE.test(contentType) || /^\s*[[{]/.test(text)) {
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return text;
}

/** Release the connection held by an unread body (important for undici/Node keep-alive) */
export function discardBody(response: Response): void {
	if (response.body && !response.bodyUsed) {
		response.body.cancel().catch(() => undefined);
	}
}
