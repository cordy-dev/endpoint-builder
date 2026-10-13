import type { StandardSchemaV1 } from "./standard";

export type { StandardSchemaV1 } from "./standard";

/**
 * Any [Standard Schema](https://standardschema.dev) v1 validator:
 * zod, valibot, arktype, effect/schema, yup, ... Wrap plain functions with `schema(fn)`.
 */
export type Schema<Input = any, Output = any> = StandardSchemaV1<Input, Output>;

/** Infer the type a schema accepts. */
export type InferInput<S> = S extends StandardSchemaV1<infer I, any> ? I : unknown;

/** Infer the type a schema produces. */
export type InferOutput<S> = S extends StandardSchemaV1<any, infer O> ? O : unknown;

export type Issue = StandardSchemaV1.Issue;

export type ValidationOutcome<T> =
	| { readonly success: true; readonly value: T }
	| { readonly success: false; readonly issues: readonly Issue[]; readonly cause?: unknown };

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		"~standard" in value &&
		typeof (value as StandardSchemaV1)["~standard"]?.validate === "function"
	);
}

function issuesFromThrown(error: unknown): readonly Issue[] {
	// zod-like errors carry `issues`; keep them when they look right
	const issues = (error as { issues?: unknown })?.issues;
	if (Array.isArray(issues) && issues.every(i => typeof i?.message === "string")) {
		return issues as Issue[];
	}
	return [{ message: error instanceof Error ? error.message : String(error) }];
}

/**
 * Turn a plain function into a Standard Schema. Throw to reject a value;
 * the thrown message becomes the validation issue. Async functions are supported.
 *
 * ```ts
 * api.get("/count").returns(schema(v => { if (typeof v !== "number") throw new Error("expected a number"); return v * 2; }))
 * ```
 *
 * The input type is `unknown`; use zod, valibot, arktype, ... when you need a typed `body` or `query`.
 */
export function schema<Output>(fn: (value: unknown) => Output | Promise<Output>): StandardSchemaV1<unknown, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				try {
					const output = fn(value);
					return output instanceof Promise
						? output.then(
							(v): StandardSchemaV1.Result<Output> => ({ value: v }),
							(e: unknown): StandardSchemaV1.Result<Output> => ({ issues: issuesFromThrown(e) }),
						)
						: { value: output };
				} catch (error) {
					return { issues: issuesFromThrown(error) };
				}
			},
		},
	};
}

function fromStandardResult<T>(result: StandardSchemaV1.Result<T>): ValidationOutcome<T> {
	return result.issues
		? { success: false, issues: result.issues }
		: { success: true, value: result.value };
}

/**
 * Run a Standard Schema against a value.
 * Stays synchronous for synchronous validators (no extra microtask) and never throws.
 */
export function validate<T>(schema: Schema<unknown, T>, value: unknown): ValidationOutcome<T> | Promise<ValidationOutcome<T>> {
	if (!isStandardSchema(schema)) {
		return {
			success: false,
			issues: [{ message: "Not a Standard Schema. Use zod, valibot, arktype, ... or wrap a function with schema(fn)." }],
		};
	}
	try {
		const result = schema["~standard"].validate(value);
		if (result instanceof Promise) {
			return result.then(fromStandardResult, (e: unknown) => ({ success: false as const, issues: issuesFromThrown(e), cause: e }));
		}
		return fromStandardResult(result);
	} catch (error) {
		return { success: false, issues: issuesFromThrown(error), cause: error };
	}
}

/** Format an issue path such as `user.tags[2]` */
export function formatIssuePath(path: Issue["path"]): string {
	if (!path || path.length === 0) return "";
	let out = "";
	for (const segment of path) {
		const key = typeof segment === "object" ? segment.key : segment;
		out += typeof key === "number" ? `[${key}]` : out ? `.${String(key)}` : String(key);
	}
	return out;
}
