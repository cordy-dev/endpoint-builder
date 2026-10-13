import type { ErrorRequest } from "../errors";
import type { HttpMethod } from "../types";

const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export function isAbsoluteUrl(url: string): boolean {
	return ABSOLUTE_URL_RE.test(url) || url.startsWith("//");
}

/** Join a base URL and a path with exactly one slash. Absolute paths win over the base. */
export function joinUrl(baseUrl: string, path: string): string {
	if (!baseUrl || isAbsoluteUrl(path)) return path;
	if (!path) return baseUrl;
	const baseEndsWithSlash = baseUrl.endsWith("/");
	const pathStartsWithSlash = path.startsWith("/");
	if (baseEndsWithSlash && pathStartsWithSlash) return baseUrl + path.slice(1);
	if (!baseEndsWithSlash && !pathStartsWithSlash && !path.startsWith("?")) return `${baseUrl}/${path}`;
	return baseUrl + path;
}

const SENSITIVE_PARAM = /key|token|secret|passw(?:or)?d|signature|credential|(?:^|[-_])(?:sig|auth)(?:[-_]|$)/i;

/**
 * Mask the values of credential-like query parameters (`api_key`, `token`, `signature`, ...)
 * so a URL is safe to show in error messages, logs and LLM context.
 */
export function redactUrl(url: string): string {
	const start = url.indexOf("?");
	if (start === -1) return url;
	const hash = url.indexOf("#", start);
	const end = hash === -1 ? url.length : hash;

	const query = url.slice(start + 1, end).split("&").map((pair) => {
		const eq = pair.indexOf("=");
		if (eq === -1) return pair;
		let name = pair.slice(0, eq);
		try {
			name = decodeURIComponent(name);
		} catch { /* keep the raw name */ }
		return SENSITIVE_PARAM.test(name) ? `${pair.slice(0, eq)}=***` : pair;
	}).join("&");
	return url.slice(0, start + 1) + query + url.slice(end);
}

/** The request description attached to errors: credentials in the query string are masked */
export function errorRequest(ctx: { method: HttpMethod; url: string }): ErrorRequest {
	return { method: ctx.method, url: redactUrl(ctx.url) };
}
