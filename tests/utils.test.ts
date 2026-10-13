import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { buildPath, createQuerySerializer, type InferInput, type InferOutput, path, type PathParams, schema, validate } from "../src";

type P = string | number | bigint | boolean;

describe("path params", () => {
	it("extracts param types", () => {
		expectTypeOf<PathParams<"/users/:id">>().toEqualTypeOf<{ id: P }>();
		expectTypeOf<PathParams<"/users/:userId/posts/:postId">>().toEqualTypeOf<{ userId: P; postId: P }>();
		expectTypeOf<PathParams<"/files/:name.json">>().toEqualTypeOf<{ name: P }>();
		expectTypeOf<PathParams<"/users/{id}/avatar-{size}.png">>().toEqualTypeOf<{ id: P; size: P }>();
		expectTypeOf<PathParams<"/posts/:id?">>().toEqualTypeOf<{ id?: P | undefined }>();
		expectTypeOf<PathParams<"http://localhost:3000/users">>().toEqualTypeOf<{}>();
		expectTypeOf<PathParams<"/static">>().toEqualTypeOf<{}>();
	});

	it("builds paths at runtime", () => {
		expect(buildPath("/users/:id/posts/:postId", { id: 1, postId: "a b" })).toBe("/users/1/posts/a%20b");
		expect(buildPath("/files/:name.json", { name: "x" })).toBe("/files/x.json");
		expect(buildPath("/users/{id}/avatar-{size}.png", { id: 1, size: 64 })).toBe("/users/1/avatar-64.png");
		expect(buildPath("/posts/:id?", {})).toBe("/posts");
		expect(buildPath("/posts/:id?", { id: 3 })).toBe("/posts/3");
		expect(buildPath("http://localhost:3000/users/:id", { id: 1 })).toBe("http://localhost:3000/users/1");
		// `:id` must not clobber `:idx` (1.x bug)
		expect(buildPath("/a/:idx/:id", { idx: "X", id: "Y" })).toBe("/a/X/Y");
	});

	it("throws on missing params", () => {
		expect(() => buildPath("/users/:id", {} as never)).toThrow("Missing path parameter \"id\"");
	});

	it("path() pre-binds templates", () => {
		const userPath = path("/users/:id");
		expect(userPath({ id: 5 })).toBe("/users/5");
	});
});

describe("query serializer", () => {
	const input = { ids: [1, 2], q: "a b", nested: { x: 1, deep: { y: true } }, date: new Date("2026-01-01T00:00:00Z"), none: null };

	it("repeats arrays and brackets nested objects by default", () => {
		expect(createQuerySerializer()(input)).toBe(
			"ids=1&ids=2&q=a%20b&nested%5Bx%5D=1&nested%5Bdeep%5D%5By%5D=true&date=2026-01-01T00%3A00%3A00.000Z",
		);
	});

	it("supports other array formats", () => {
		expect(createQuerySerializer({ arrayFormat: "comma" })({ ids: [1, 2] })).toBe("ids=1,2");
		expect(createQuerySerializer({ arrayFormat: "brackets" })({ ids: [1, 2] })).toBe("ids%5B%5D=1&ids%5B%5D=2");
		expect(createQuerySerializer({ arrayFormat: "indices" })({ ids: [1, 2] })).toBe("ids%5B0%5D=1&ids%5B1%5D=2");
	});
});

describe("validators", () => {
	it("supports zod, valibot and schema(fn)", async () => {
		const zodSchema = z.object({ n: z.coerce.number() });
		const valibotSchema = v.object({ n: v.number() });
		const fn = schema((value) => {
			if (typeof value !== "number") throw new Error("not a number");
			return value * 2;
		});

		expect(await validate(zodSchema, { n: "1" })).toEqual({ success: true, value: { n: 1 } });
		expect(await validate(valibotSchema, { n: 1 })).toEqual({ success: true, value: { n: 1 } });
		expect(await validate(fn, 2)).toEqual({ success: true, value: 4 });
		expect(await validate(fn, "x")).toMatchObject({ success: false, issues: [{ message: "not a number" }] });

		expectTypeOf<InferOutput<typeof zodSchema>>().toEqualTypeOf<{ n: number }>();
		expectTypeOf<InferInput<typeof zodSchema>>().toEqualTypeOf<{ n: unknown }>();
		expectTypeOf<InferOutput<typeof valibotSchema>>().toEqualTypeOf<{ n: number }>();
		expectTypeOf<InferOutput<typeof fn>>().toEqualTypeOf<number>();
		expectTypeOf<InferInput<typeof fn>>().toEqualTypeOf<unknown>();
	});

	it("schema(fn) keeps zod-like issues from thrown errors", async () => {
		const parse = schema((value) => z.object({ id: z.number() }).parse(value));
		const outcome = await validate(parse, { id: "1" });
		expect(outcome).toMatchObject({ success: false, issues: [{ path: ["id"] }] });
	});

	it("handles async validators", async () => {
		const asyncSchema = z.string().refine(async s => s.length > 1);
		expect(await validate(asyncSchema, "ab")).toEqual({ success: true, value: "ab" });
		expect((await validate(asyncSchema, "a")).success).toBe(false);
		const asyncFn = schema(async (value) => {
			await Promise.resolve();
			if (value !== "ok") throw new Error("bad");
			return value;
		});
		expect((await validate(asyncFn, "ok")).success).toBe(true);
		expect((await validate(asyncFn, "no")).success).toBe(false);
	});

	it("validates synchronously when possible", () => {
		expect(validate(z.string(), "sync")).not.toBeInstanceOf(Promise);
		expect(validate(schema(v => String(v)), 1)).not.toBeInstanceOf(Promise);
	});

	it("rejects bare functions with a hint (they are no longer accepted)", async () => {
		const bare = (value: unknown) => value;
		// @ts-expect-error wrap functions with schema(fn)
		const outcome = await validate(bare, 1);
		expect(outcome).toMatchObject({ success: false, issues: [{ message: expect.stringContaining("schema(fn)") }] });
	});
});
