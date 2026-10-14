import type { StandardSchemaV1 } from "../schema/standard";

type Result<T> = StandardSchemaV1.Result<T>;

/**
 * Let a schema accept `undefined`. Used for optional request bodies:
 * the call may leave `body` out, and nothing is sent.
 */
export function optional<In, Out = In>(
	schema: StandardSchemaV1<In, Out>,
): StandardSchemaV1<In | undefined, Out | undefined> {
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				return value === undefined ? { value: undefined } : schema["~standard"].validate(value);
			},
		},
	};
}

/** How an array in the query string is written */
export type QueryStyle = "comma" | "space" | "pipe";

const SEPARATORS: Record<QueryStyle, string> = { comma: ",", space: " ", pipe: "|" };

/**
 * Write the arrays of some query keys as one delimited value (`tags=a,b`, `tags=a b`, `tags=a|b`),
 * as OpenAPI `style: form, explode: false`, `spaceDelimited` and `pipeDelimited` do.
 * Other keys keep the client's `arrayFormat`. The input type of the schema is unchanged.
 *
 * ```ts
 * endpoint.get("/pets").query(queryStyle(Query, { tags: "pipe" }))
 * ```
 */
export function queryStyle<In, Out>(
	schema: StandardSchemaV1<In, Out>,
	styles: { readonly [key: string]: QueryStyle },
): StandardSchemaV1<In, Out> {
	const join = (checked: Result<Out>): Result<Out> => {
		const value = checked.issues ? undefined : checked.value;
		if (typeof value !== "object" || value === null) return checked;
		const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
		for (const [key, style] of Object.entries(styles)) {
			const items = out[key];
			if (Array.isArray(items)) out[key] = items.map(String).join(SEPARATORS[style]);
		}
		return { value: out as Out };
	};
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				const result = schema["~standard"].validate(value);
				return result instanceof Promise ? result.then(join) : join(result);
			},
		},
	};
}

/**
 * A schema that accepts anything and only carries the type `T`. Generated clients use it with
 * `--no-validate`: the types are checked by TypeScript, nothing is checked at runtime.
 */
export function unchecked<T>(): StandardSchemaV1<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate: (value) => ({ value: value as T }),
		},
	};
}
