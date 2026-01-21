/**
 * Standard Schema interface (v1)
 * Compatible with zod, valibot, arktype, etc.
 * https://github.com/standard-schema/standard-schema
 */

export interface StandardSchemaProps<T = unknown> {
	readonly version: 1
	readonly vendor: string
	readonly validate: (
		value: unknown
	) => StandardSchemaResult<T> | Promise<StandardSchemaResult<T>>
}

export interface StandardSchema<T = unknown> {
	readonly "~standard": StandardSchemaProps<T>
}

export interface StandardSchemaResult<T> {
	readonly value?: T
	readonly issues?: readonly StandardSchemaIssue[]
}

export interface StandardSchemaIssue {
	readonly message: string
	readonly path?: readonly (string | number)[]
}

/**
 * Infer output type from a Standard Schema
 */
export type InferOutput<S> = S extends StandardSchema<infer T> ? T : never

/**
 * Validation result type
 */
export type ValidationResult<T> =
	| { success: true; data: T }
	| { success: false; issues: readonly StandardSchemaIssue[] }

/**
 * Validate data against a Standard Schema
 * @param schema - Standard Schema compliant schema
 * @param data - Data to validate
 * @returns Validation result with success flag
 */
export async function validateWithSchema<T>(
	schema: StandardSchema<T>,
	data: unknown
): Promise<ValidationResult<T>> {
	const result = schema["~standard"].validate(data);

	// Handle async validation
	const resolved = result instanceof Promise ? await result : result;

	if (resolved.issues && resolved.issues.length > 0) {
		return { success: false, issues: resolved.issues };
	}

	return { success: true, data: resolved.value as T };
}

/**
 * Check if a value is a Standard Schema
 */
export function isStandardSchema(value: unknown): value is StandardSchema {
	return (
		typeof value === "object" &&
		value !== null &&
		"~standard" in value &&
		typeof (value as StandardSchema)["~standard"] === "object" &&
		(value as StandardSchema)["~standard"].version === 1
	);
}
