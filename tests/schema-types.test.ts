import { describe, expect, expectTypeOf, it } from "vitest";

import type { InferOutput, StandardSchema } from "../src/types/schema";
import { isStandardSchema, validateWithSchema } from "../src/types/schema";

// Mock schema that follows Standard Schema interface
const mockUserSchema = {
	"~standard": {
		version: 1 as const,
		vendor: "test",
		validate: (value: unknown) => {
			if (
				typeof value === "object" &&
				value !== null &&
				"id" in value &&
				"name" in value
			) {
				return { value: value as { id: number; name: string } };
			}
			return { issues: [{ message: "Invalid user" }] };
		}
	}
} satisfies StandardSchema<{ id: number; name: string }>;

// Mock schema with async validation
const mockAsyncSchema = {
	"~standard": {
		version: 1 as const,
		vendor: "test-async",
		validate: async (value: unknown) => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			if (typeof value === "string") {
				return { value };
			}
			return { issues: [{ message: "Expected string" }] };
		}
	}
} satisfies StandardSchema<string>;

describe("Schema Types", () => {
	describe("InferOutput", () => {
		it("should infer output type from schema", () => {
			type Output = InferOutput<typeof mockUserSchema>
			expectTypeOf<Output>().toEqualTypeOf<{ id: number; name: string }>();
		});
	});

	describe("validateWithSchema", () => {
		it("should validate valid data", async () => {
			const result = await validateWithSchema(mockUserSchema, {
				id: 1,
				name: "John"
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual({ id: 1, name: "John" });
			}
		});

		it("should reject invalid data", async () => {
			const result = await validateWithSchema(mockUserSchema, { invalid: true });
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.issues).toHaveLength(1);
				expect(result.issues[0]?.message).toBe("Invalid user");
			}
		});

		it("should handle async validation", async () => {
			const result = await validateWithSchema(mockAsyncSchema, "hello");
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toBe("hello");
			}
		});

		it("should handle async validation errors", async () => {
			const result = await validateWithSchema(mockAsyncSchema, 123);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.issues[0]?.message).toBe("Expected string");
			}
		});
	});

	describe("isStandardSchema", () => {
		it("should return true for valid Standard Schema", () => {
			expect(isStandardSchema(mockUserSchema)).toBe(true);
		});

		it("should return false for non-schema objects", () => {
			expect(isStandardSchema({})).toBe(false);
			expect(isStandardSchema(null)).toBe(false);
			expect(isStandardSchema({ "~standard": {} })).toBe(false);
			expect(isStandardSchema({ "~standard": { version: 2 } })).toBe(false);
		});
	});
});
