import type { HttpHeaders } from "../types";

/**
 * Merge two header objects, with source headers taking precedence
 * @param target - Target headers object
 * @param src - Source headers to merge (optional)
 * @returns New merged headers object
 */
export function mergeHeaders(target: HttpHeaders = {}, src?: HttpHeaders): HttpHeaders {
	if (!src || Object.keys(src).length === 0) {
		return target;
	}

	const result: HttpHeaders = { ...target };

	for (const [key, value] of Object.entries(src)) {
		if (value !== undefined) {
			result[key] = Array.isArray(value) ? value : String(value);
		}
	}

	return result;
}