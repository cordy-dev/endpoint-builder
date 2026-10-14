import type { HeadersInput } from "../types";

/** Merge header inputs into `target` (later wins, `null`/`undefined` deletes). */
export function applyHeaders(target: Headers, input: HeadersInput | undefined): Headers {
	if (!input) return target;
	if (input instanceof Headers || Array.isArray(input)) {
		new Headers(input).forEach((value, key) => target.set(key, value));
		return target;
	}
	for (const key in input) {
		const value = input[key];
		if (value === undefined || value === null) target.delete(key);
		else target.set(key, String(value));
	}
	return target;
}

/** Normalize any header input into a plain lower-cased record (used for immutable config) */
export function toHeaderRecord(input: HeadersInput | undefined): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	if (!input) return out;
	if (input instanceof Headers || Array.isArray(input)) {
		new Headers(input).forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	for (const key in input) {
		const value = input[key];
		if (value !== undefined) out[key.toLowerCase()] = value === null ? null : String(value);
	}
	return out;
}

/** Build a `Headers` instance from a lower-cased record (skips `null` = removed) */
export function headersFromRecord(record: Record<string, string | null>): Headers {
	const headers = new Headers();
	for (const key in record) {
		const value = record[key];
		if (value !== null && value !== undefined) headers.set(key, value);
	}
	return headers;
}
