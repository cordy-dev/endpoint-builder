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
