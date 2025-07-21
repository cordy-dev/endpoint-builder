import type { HttpHeaders } from "../types";

export function mergeHeaders(target: HttpHeaders = {}, src?: HttpHeaders): HttpHeaders {
	if (!src) return target;
	const res: HttpHeaders = { ...target };
	Object.entries(src).forEach(([k, v]) => {
		if (v === undefined) return;
		res[k] = Array.isArray(v) ? v : String(v);
	});
	return res;
}