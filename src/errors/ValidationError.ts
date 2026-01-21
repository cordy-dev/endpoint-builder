import type { StandardSchemaIssue } from "../types/schema";

/**
 * Validation error when response doesn't match schema
 */
export class ValidationError extends Error {
	readonly type = "validation" as const;
	override readonly name = "ValidationError";

	constructor(
		public readonly issues: readonly StandardSchemaIssue[],
		public readonly received: unknown
	) {
		const firstIssue = issues[0]?.message ?? "Unknown validation error";
		super(`Validation failed: ${firstIssue}`);
	}
}
