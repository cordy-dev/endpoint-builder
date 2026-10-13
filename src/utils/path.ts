/**
 * Type-safe path parameters.
 *
 * Supported syntaxes:
 * - `/users/:id`          → required `id`
 * - `/users/:id?`         → optional `id` (segment dropped when missing)
 * - `/files/:name.json`   → `name` (param name stops at `.` / `-`)
 * - `/users/{id}`         → required `id` (OpenAPI style, may be inside a segment)
 */

export type PathParamValue = string | number | bigint | boolean;

type Split<P extends string> = P extends `${infer Head}/${infer Tail}` ? Head | Split<Tail> : P;

type TrimName<N extends string> =
	N extends `${infer A}.${string}` ? TrimName<A>
		: N extends `${infer A}-${string}` ? TrimName<A>
			: N;

type BraceParams<S extends string> =
	S extends `${string}{${infer Name}}${infer Rest}` ? Name | BraceParams<Rest> : never;

type SegmentRequired<S extends string> =
	S extends `:${string}?` ? never
		: S extends `:${infer Name}` ? TrimName<Name>
			: BraceParams<S>;

type SegmentOptional<S extends string> =
	S extends `:${infer Name}?` ? TrimName<Name> : never;

type NonEmpty<T> = T extends "" ? never : T;

/** Union of required parameter names: `"/a/:x/:y?"` → `"x"` */
export type RequiredParamNames<P extends string> = NonEmpty<SegmentRequired<Split<P>>>;
/** Union of optional parameter names: `"/a/:x/:y?"` → `"y"` */
export type OptionalParamNames<P extends string> = NonEmpty<SegmentOptional<Split<P>>>;
/** Union of all parameter names */
export type ParamNames<P extends string> = RequiredParamNames<P> | OptionalParamNames<P>;

/** `"/users/:id/posts/:postId?"` → `{ id: PathParamValue; postId?: PathParamValue }` */
export type PathParams<P extends string> = string extends P
	? Record<string, PathParamValue>
	: { [K in RequiredParamNames<P>]: PathParamValue } & { [K in OptionalParamNames<P>]?: PathParamValue | undefined } extends infer O
		? { [K in keyof O]: O[K] }
		: never;

export type HasParams<P extends string> = [ParamNames<P>] extends [never] ? false : true;
export type HasRequiredParams<P extends string> = [RequiredParamNames<P>] extends [never] ? false : true;

// Params must start a segment (`/:id`) so ports like `localhost:3000` are never treated as params
const PARAM_RE = /(^|\/):([A-Za-z_][A-Za-z0-9_]*)(\?)?|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const HAS_PARAM_RE = /(^|\/):[A-Za-z_]|\{[A-Za-z_]/;

/** Fast check used to skip the replacement entirely for static paths */
export function hasPathParams(path: string): boolean {
	return HAS_PARAM_RE.test(path);
}

/**
 * Interpolate parameters into a path template. Values are URI-encoded.
 * @throws TypeError when a required parameter is missing
 */
export function buildPath<P extends string>(template: P, params: PathParams<P> | Record<string, unknown> | undefined): string {
	if (!hasPathParams(template)) return template;
	const values = (params ?? {}) as Record<string, unknown>;

	return template.replace(PARAM_RE, (_match, lead: string | undefined, colonName: string | undefined, optional: string | undefined, braceName: string | undefined) => {
		const name = (colonName ?? braceName)!;
		const value = values[name];
		if (value === undefined || value === null || value === "") {
			if (optional) return "";
			throw new TypeError(`Missing path parameter "${name}" for "${template}"`);
		}
		return (lead ?? "") + encodeURIComponent(String(value as PathParamValue));
	});
}

/** Pre-bind a path template: `const userPath = path("/users/:id"); userPath({ id: 1 })` */
export function path<P extends string>(template: P): (params: PathParams<P>) => string {
	return params => buildPath(template, params);
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @internal turn a path template into a matcher that captures the params (used by the mock server) */
export function compilePath(template: string): { regex: RegExp; names: string[] } {
	const names: string[] = [];
	let source = "";
	let last = 0;
	for (const match of template.matchAll(PARAM_RE)) {
		const [whole, lead, colonName, optional, braceName] = match;
		source += escapeRegex(template.slice(last, match.index));
		names.push((colonName ?? braceName)!);
		source += optional ? `(?:${escapeRegex(lead ?? "")}([^/]+))?` : `${escapeRegex(lead ?? "")}([^/]+)`;
		last = match.index + whole.length;
	}
	source += escapeRegex(template.slice(last));
	return { regex: new RegExp(`^${source}/?$`), names };
}
