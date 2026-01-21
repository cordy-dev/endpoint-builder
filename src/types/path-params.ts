/**
 * Path parameter type extraction using TypeScript template literal types
 */

/**
 * Extract path parameter names from a URL pattern
 * e.g., '/users/:id/posts/:postId' -> 'id' | 'postId'
 */
export type ExtractParamNames<T extends string> =
	T extends `${string}:${infer Param}/${infer Rest}`
		? Param | ExtractParamNames<`/${Rest}`>
		: T extends `${string}:${infer Param}`
			? Param
			: never

/**
 * Convert parameter names to object type
 * e.g., 'id' | 'postId' -> { id: string | number; postId: string | number }
 */
export type ExtractPathParams<T extends string> =
	ExtractParamNames<T> extends never
		? Record<string, never>
		: { [K in ExtractParamNames<T>]: string | number }

/**
 * Check if path has parameters
 */
export type HasPathParams<T extends string> = T extends `${string}:${string}` ? true : false

/**
 * Replace path parameters with values
 * @param template - URL template with :param placeholders
 * @param params - Object with parameter values
 * @returns URL with parameters replaced
 */
export function buildPath<T extends string>(
	template: T,
	params: ExtractPathParams<T>
): string {
	let result: string = template;
	for (const [key, value] of Object.entries(params)) {
		result = result.replace(`:${key}`, String(value));
	}
	return result;
}
