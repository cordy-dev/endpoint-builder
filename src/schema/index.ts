import type { StandardSchemaV1 } from "./standard";

export type { StandardSchemaV1 } from "./standard";

/** Anything exposing a `parse(value)` method that throws on invalid input (zod, superstruct-like, custom). */
export interface ParserLike<Output = unknown> {
	parse(value: unknown): Output;
}

/** Plain validator function: returns the (possibly transformed) value or throws. */
export type ValidatorFn<Input = unknown, Output = Input> = (value: Input) => Output | Promise<Output>;

/**
 * Any supported validator:
 * - a Standard Schema (zod, valibot, arktype, effect, yup, ...)
 * - an object with `parse(value)`
 * - a function `(value) => output` that throws on invalid input
 */
export type Schema<Input = any, Output = any> =
	| StandardSchemaV1<Input, Output>
	| ParserLike<Output>
	| ValidatorFn<Input, Output>;

/** Infer the type a schema accepts. */
export type InferInput<S> =
	S extends StandardSchemaV1<infer I, any> ? I
		: S extends ParserLike<infer O> ? O
			: S extends (value: infer I) => any ? I
				: unknown;

/** Infer the type a schema produces. */
export type InferOutput<S> =
	S extends StandardSchemaV1<any, infer O> ? O
		: S extends ParserLike<infer O> ? O
			: S extends (value: any) => infer R ? Awaited<R>
				: unknown;

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

function fromStandardResult<T>(result: StandardSchemaV1.Result<T>): ValidationOutcome<T> {
	return result.issues
		? { success: false, issues: result.issues }
		: { success: true, value: result.value };
}

/**
 * Run any supported schema against a value.
 * Stays synchronous for synchronous validators (no extra microtask) and never throws.
 */
export function validate<T>(schema: Schema<unknown, T>, value: unknown): ValidationOutcome<T> | Promise<ValidationOutcome<T>> {
	try {
		if (isStandardSchema(schema)) {
			const result = (schema)["~standard"].validate(value);
			return result instanceof Promise ? result.then(fromStandardResult) : fromStandardResult(result);
		}

		const output = typeof schema === "function"
			? schema(value)
			: schema.parse(value);

		if (output instanceof Promise) {
			return output.then(
				(v: T) => ({ success: true as const, value: v }),
				(e: unknown) => ({ success: false as const, issues: issuesFromThrown(e), cause: e }),
			);
		}
		return { success: true, value: output };
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
