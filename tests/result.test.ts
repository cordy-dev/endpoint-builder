import { describe, expect, expectTypeOf, it } from "vitest";

import { HttpError, ValidationError } from "../src/errors";
import {
	err,
	isErr,
	isOk,
	mapErr,
	mapResult,
	ok,
	type Result,
	unwrapOr,
	unwrapResult} from "../src/types/result";

describe("Result Type", () => {
	describe("ok", () => {
		it("should create success result", () => {
			const result = ok({ id: 1, name: "John" });

			expect(result.data).toEqual({ id: 1, name: "John" });
			expect(result.error).toBeUndefined();
		});

		it("should work with primitives", () => {
			expect(ok(42).data).toBe(42);
			expect(ok("hello").data).toBe("hello");
			expect(ok(true).data).toBe(true);
		});
	});

	describe("err", () => {
		it("should create error result", () => {
			const error = new HttpError(404, "Not Found");
			const result = err(error);

			expect(result.data).toBeUndefined();
			expect(result.error).toBe(error);
		});
	});

	describe("isOk", () => {
		it("should return true for success result", () => {
			const result = ok({ id: 1 });
			expect(isOk(result)).toBe(true);
		});

		it("should return false for error result", () => {
			const result = err(new HttpError(500, "Error"));
			expect(isOk(result)).toBe(false);
		});
	});

	describe("isErr", () => {
		it("should return true for error result", () => {
			const result = err(new ValidationError([], {}));
			expect(isErr(result)).toBe(true);
		});

		it("should return false for success result", () => {
			const result = ok("success");
			expect(isErr(result)).toBe(false);
		});
	});

	describe("type narrowing", () => {
		it("should narrow types correctly", () => {
			const result: Result<{ id: number }, HttpError> = ok({ id: 1 });

			if (result.error) {
				expectTypeOf(result.error).toEqualTypeOf<HttpError>();
				expectTypeOf(result.data).toEqualTypeOf<undefined>();
			} else {
				expectTypeOf(result.data).toEqualTypeOf<{ id: number }>();
				expectTypeOf(result.error).toEqualTypeOf<undefined>();
			}
		});
	});

	describe("unwrapResult", () => {
		it("should return data for success result", () => {
			const result = ok({ id: 1 });
			expect(unwrapResult(result)).toEqual({ id: 1 });
		});

		it("should throw for error result", () => {
			const error = new HttpError(500, "Error");
			const result = err(error);
			expect(() => unwrapResult(result)).toThrow(error);
		});
	});

	describe("unwrapOr", () => {
		it("should return data for success result", () => {
			const result = ok(42);
			expect(unwrapOr(result, 0)).toBe(42);
		});

		it("should return default for error result", () => {
			const result = err(new HttpError(500, "Error"));
			expect(unwrapOr(result, 0)).toBe(0);
		});
	});

	describe("mapResult", () => {
		it("should transform success data", () => {
			const result = ok(5);
			const mapped = mapResult(result, (n) => n * 2);

			expect(mapped.data).toBe(10);
			expect(mapped.error).toBeUndefined();
		});

		it("should pass through error", () => {
			const error = new HttpError(404, "Not Found");
			const result = err(error);
			const mapped = mapResult(result, (n: number) => n * 2);

			expect(mapped.data).toBeUndefined();
			expect(mapped.error).toBe(error);
		});
	});

	describe("mapErr", () => {
		it("should transform error", () => {
			const result = err(new HttpError(404, "Not Found"));
			const mapped = mapErr(result, (e) => new Error(`Wrapped: ${e.message}`));

			expect(mapped.data).toBeUndefined();
			expect(mapped.error?.message).toBe("Wrapped: HTTP 404: Not Found");
		});

		it("should pass through success", () => {
			const result = ok(42);
			const mapped = mapErr(result, (e: HttpError) => new Error(e.message));

			expect(mapped.data).toBe(42);
			expect(mapped.error).toBeUndefined();
		});
	});
});
