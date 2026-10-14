import type { QueryInput } from "../types";

export type ArrayFormat =
	/** `ids=1&ids=2` (default) */
	| "repeat"
	/** `ids[]=1&ids[]=2` */
	| "brackets"
	/** `ids[0]=1&ids[1]=2` */
	| "indices"
	/** `ids=1,2` */
	| "comma";

export interface QuerySerializerOptions {
	arrayFormat?: ArrayFormat;
}

export type QuerySerializer = (query: Record<string, unknown>) => string;

function primitive(value: unknown): string | undefined {
	switch (typeof value) {
		case "string":
			return value;
		case "number":
			return Number.isFinite(value) ? String(value) : undefined;
		case "boolean":
		case "bigint":
			return String(value);
		default:
			return value instanceof Date ? value.toISOString() : undefined;
	}
}

function encode(value: string): string {
	return encodeURIComponent(value);
}

/**
 * Build a query serializer. Nested objects use bracket notation (`filter[name]=x`),
 * `null`/`undefined` are skipped, dates become ISO strings.
 */
export function createQuerySerializer(options: QuerySerializerOptions = {}): QuerySerializer {
	const arrayFormat = options.arrayFormat ?? "repeat";

	const write = (parts: string[], key: string, value: unknown): void => {
		if (value === undefined || value === null) return;

		if (Array.isArray(value)) {
			if (arrayFormat === "comma") {
				const items = value.map(primitive).filter((v): v is string => v !== undefined);
				if (items.length) parts.push(`${encode(key)}=${items.map(encode).join(",")}`);
				return;
			}
			value.forEach((item, index) => {
				const itemKey = arrayFormat === "brackets" ? `${key}[]` : arrayFormat === "indices" ? `${key}[${index}]` : key;
				write(parts, itemKey, item);
			});
			return;
		}

		const str = primitive(value);
		if (str !== undefined) {
			parts.push(`${encode(key)}=${encode(str)}`);
			return;
		}

		if (typeof value === "object") {
			for (const [childKey, child] of Object.entries(value)) {
				write(parts, `${key}[${childKey}]`, child);
			}
		}
	};

	return (query) => {
		const parts: string[] = [];
		for (const key in query) {
			write(parts, key, query[key]);
		}
		return parts.join("&");
	};
}

export const defaultQuerySerializer: QuerySerializer = createQuerySerializer();

/** Normalize any query input into a query string (without the leading `?`) */
export function serializeQuery(
	query: QueryInput | Record<string, unknown> | undefined,
	serializer: QuerySerializer,
): string {
	if (query === undefined || query === null) return "";
	if (typeof query === "string") return query.startsWith("?") ? query.slice(1) : query;
	if (query instanceof URLSearchParams) return query.toString();
	return serializer(query);
}

/** Append a query string to a URL that may already contain one */
export function appendQuery(url: string, query: string): string {
	if (!query) return url;
	const hash = url.indexOf("#");
	const base = hash === -1 ? url : url.slice(0, hash);
	const fragment = hash === -1 ? "" : url.slice(hash);
	return `${base}${base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?"}${query}${fragment}`;
}
