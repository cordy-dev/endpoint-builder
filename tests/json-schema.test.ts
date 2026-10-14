import { describe, expect, expectTypeOf, it } from "vitest";

import { createClient, type InferInput, type InferOutput, validate, ValidationError } from "../src";
import { type JsonSchema, jsonSchema } from "../src/openapi/json-schema";
import { json, mockFetch } from "./helpers";

/** [message, path] pairs of the issues, or "ok" */
async function check(schema: JsonSchema | boolean, value: unknown, defs: Record<string, JsonSchema> = {}) {
	const outcome = await validate(jsonSchema(schema, defs), value);
	if (outcome.success) return "ok";
	return outcome.issues.map(issue => `${(issue.path ?? []).join(".")}: ${issue.message}`);
}

describe("jsonSchema: types", () => {
	it("checks the basic types", async () => {
		expect(await check({ type: "string" }, "a")).toBe("ok");
		expect(await check({ type: "string" }, 1)).toEqual([": Expected string, received number"]);
		expect(await check({ type: "number" }, 1.5)).toBe("ok");
		expect(await check({ type: "number" }, Number.NaN)).toEqual([": Expected number, received number"]);
		expect(await check({ type: "integer" }, 2)).toBe("ok");
		expect(await check({ type: "integer" }, 2.5)).toEqual([": Expected integer, received number"]);
		expect(await check({ type: "boolean" }, false)).toBe("ok");
		expect(await check({ type: "null" }, null)).toBe("ok");
		expect(await check({ type: "object" }, [])).toEqual([": Expected object, received array"]);
		expect(await check({ type: "array" }, {})).toEqual([": Expected array, received object"]);
	});

	it("supports type unions and nullable", async () => {
		expect(await check({ type: ["string", "null"] }, null)).toBe("ok");
		expect(await check({ type: ["string", "null"] }, 1)).toEqual([": Expected string | null, received number"]);
		expect(await check({ type: "string", nullable: true }, null)).toBe("ok");
		expect(await check({ type: "string" }, null)).toEqual([": Expected string, received null"]);
	});

	it("a type mismatch is one issue, not a cascade", async () => {
		expect(await check({ type: "string", minLength: 3, enum: ["abc"], pattern: "^a" }, 5)).toEqual([": Expected string, received number"]);
	});

	it("true and false schemas", async () => {
		expect(await check(true, { any: "thing" })).toBe("ok");
		expect(await check(false, 1)).toEqual([": No value is allowed here"]);
		expect(await check({}, undefined)).toBe("ok");
	});
});

describe("jsonSchema: constraints", () => {
	it("enum and const compare deeply", async () => {
		expect(await check({ enum: ["a", 1, null, { x: [1] }] }, { x: [1] })).toBe("ok");
		expect(await check({ enum: ["a", "b"] }, "c")).toEqual([": Expected one of \"a\", \"b\""]);
		expect(await check({ const: { a: 1 } }, { a: 1 })).toBe("ok");
		expect(await check({ const: "x" }, "y")).toEqual([": Expected \"x\""]);
	});

	it("string keywords (length counts code points) and patterns", async () => {
		expect(await check({ type: "string", minLength: 2, maxLength: 3 }, "😀😀")).toBe("ok");
		expect(await check({ type: "string", minLength: 2 }, "a")).toEqual([": Must be at least 2 characters long"]);
		expect(await check({ type: "string", maxLength: 1 }, "ab")).toEqual([": Must be at most 1 characters long"]);
		expect(await check({ type: "string", pattern: "^[a-z]+$" }, "abc")).toBe("ok");
		expect(await check({ type: "string", pattern: "^[a-z]+$" }, "ABC")).toEqual([": Must match the pattern ^[a-z]+$"]);
		expect(await check({ type: "string", pattern: "(" }, "anything")).toBe("ok"); // an invalid pattern is skipped
	});

	it("format is only an annotation", async () => {
		expect(await check({ type: "string", format: "email" }, "not an email")).toBe("ok");
		expect(await check({ type: "string", format: "date-time" }, "yesterday")).toBe("ok");
	});

	it("number keywords", async () => {
		const schema: JsonSchema = { type: "number", minimum: 1, maximum: 10, multipleOf: 0.5 };
		expect(await check(schema, 1)).toBe("ok");
		expect(await check(schema, 10)).toBe("ok");
		expect(await check(schema, 0.5)).toEqual([": Must be at least 1"]);
		expect(await check(schema, 10.5)).toEqual([": Must be at most 10"]);
		expect(await check(schema, 1.25)).toEqual([": Must be a multiple of 0.5"]);
		expect(await check({ exclusiveMinimum: 0, exclusiveMaximum: 1 }, 0)).toEqual([": Must be greater than 0"]);
		expect(await check({ exclusiveMinimum: 0, exclusiveMaximum: 1 }, 1)).toEqual([": Must be less than 1"]);
		expect(await check({ type: "number", multipleOf: 0.1 }, 0.3)).toBe("ok"); // floating point safe
	});

	it("array keywords", async () => {
		expect(await check({ type: "array", items: { type: "integer" }, minItems: 1, maxItems: 2 }, [1, 2])).toBe("ok");
		expect(await check({ type: "array", minItems: 1 }, [])).toEqual([": Must contain at least 1 items"]);
		expect(await check({ type: "array", maxItems: 1 }, [1, 2])).toEqual([": Must contain at most 1 items"]);
		expect(await check({ type: "array", items: { type: "integer" } }, [1, "x", 3, "y"])).toEqual([
			"1: Expected integer, received string",
			"3: Expected integer, received string",
		]);
		expect(await check({ type: "array", uniqueItems: true }, [1, { a: 1 }, 2, { a: 1 }])).toEqual(["3: Items must be unique"]);
		expect(await check({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false }, ["a", 1])).toBe("ok");
		expect(await check({ type: "array", prefixItems: [{ type: "string" }], items: false }, ["a", 1])).toEqual(["1: No value is allowed here"]);
	});

	it("object keywords with exact paths", async () => {
		const schema: JsonSchema = {
			type: "object",
			required: ["id", "tags"],
			properties: { id: { type: "integer" }, tags: { type: "array", items: { type: "string" } }, owner: { type: "object", required: ["name"], properties: { name: { type: "string" } } } },
		};
		expect(await check(schema, { id: 1, tags: ["a"], extra: true })).toBe("ok"); // extra properties are allowed
		expect(await check(schema, { id: "1", tags: ["a", 2], owner: {} })).toEqual([
			"id: Expected integer, received string",
			"tags.1: Expected string, received number",
			"owner.name: Required",
		]);
		expect(await check(schema, { id: 1 })).toEqual(["tags: Required"]);
		expect(await check(schema, { id: 1, tags: [], owner: undefined })).toBe("ok"); // undefined counts as absent
	});

	it("additionalProperties and property counts", async () => {
		expect(await check({ type: "object", properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2, c: 3 })).toEqual([
			"b: Unexpected property",
			"c: Unexpected property",
		]);
		expect(await check({ type: "object", additionalProperties: { type: "number" } }, { a: 1, b: "x" })).toEqual(["b: Expected number, received string"]);
		expect(await check({ type: "object", minProperties: 1 }, {})).toEqual([": Must have at least 1 properties"]);
		expect(await check({ type: "object", maxProperties: 1 }, { a: 1, b: 2 })).toEqual([": Must have at most 1 properties"]);
	});
});

describe("jsonSchema: combinators and references", () => {
	it("allOf collects the issues of every member", async () => {
		const schema: JsonSchema = { allOf: [{ type: "object", required: ["a"] }, { type: "object", required: ["b"] }] };
		expect(await check(schema, { a: 1, b: 1 })).toBe("ok");
		expect(await check(schema, {})).toEqual(["a: Required", "b: Required"]);
	});

	it("anyOf / oneOf report the closest alternative", async () => {
		const schema: JsonSchema = {
			anyOf: [
				{ type: "object", required: ["kind", "radius"], properties: { kind: { const: "circle" }, radius: { type: "number" } } },
				{ type: "object", required: ["kind", "side"], properties: { kind: { const: "square" }, side: { type: "number" } } },
			],
		};
		expect(await check(schema, { kind: "square", side: 2 })).toBe("ok");
		expect(await check(schema, { kind: "square", side: "2" })).toEqual(["side: Expected number, received string"]);
		expect(await check({ oneOf: [{ type: "string" }, { type: "string", minLength: 1 }] }, "a")).toBe("ok"); // overlapping branches are fine
		expect(await check({ oneOf: [{ type: "string" }, { type: "number" }] }, true)).toHaveLength(1);
	});

	it("not", async () => {
		expect(await check({ not: { type: "string" } }, 1)).toBe("ok");
		expect(await check({ not: { type: "string" } }, "a")).toEqual([": Must not match the excluded schema"]);
	});

	it("resolves $ref, including recursive structures", async () => {
		const defs: Record<string, JsonSchema> = {
			Node: {
				type: "object",
				required: ["name"],
				properties: { name: { type: "string" }, children: { type: "array", items: { $ref: "#/$defs/Node" } }, parent: { anyOf: [{ $ref: "#/$defs/Node" }, { type: "null" }] } },
			},
		};
		const ref = { $ref: "#/$defs/Node" };
		expect(await check(ref, { name: "root", children: [{ name: "a", children: [{ name: "b" }] }], parent: null }, defs)).toBe("ok");
		expect(await check(ref, { name: "root", children: [{ name: "a", children: [{ name: 1 }] }] }, defs)).toEqual([
			"children.0.children.0.name: Expected string, received number",
		]);
	});

	it("an unknown reference fails loudly, a foreign one is rejected when the schema is built", async () => {
		const outcome = await validate(jsonSchema({ $ref: "#/$defs/Missing" }), 1);
		expect(outcome).toMatchObject({ success: false, issues: [{ message: expect.stringContaining("Unknown schema reference") }] });
		expect(() => jsonSchema({ $ref: "#/components/schemas/X" })).toThrow("Unsupported $ref");
	});

	it("stops collecting after 100 issues", async () => {
		const issues = await check({ type: "array", items: { type: "string" } }, Array.from({ length: 10_000 }, () => 1));
		expect(issues).toHaveLength(100);
	});
});

describe("jsonSchema as a Standard Schema", () => {
	interface User { id: number; name: string }
	const User = jsonSchema<User>({ type: "object", required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string" } } });

	it("carries T as input and output type", () => {
		expectTypeOf<InferOutput<typeof User>>().toEqualTypeOf<User>();
		expectTypeOf<InferInput<typeof User>>().toEqualTypeOf<User>();
	});

	it("returns the value untouched", async () => {
		const value = { id: 1, name: "a", extra: [1] };
		const outcome = await validate(User, value);
		expect(outcome).toEqual({ success: true, value });
		expect(outcome.success && outcome.value).toBe(value);
	});

	it("works as a response and a body schema in a client", async () => {
		const fetch = mockFetch(json({ id: 1, name: "Ann" }), json({ id: "1", name: "Ann" }));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		expect(await api.get("/u").returns(User)).toEqual({ id: 1, name: "Ann" });
		const { error } = await api.get("/u").returns(User).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect(error!.message).toBe("Invalid response at \"id\": Expected integer, received string");

		await api.post("/u").json({ id: 2, name: "Bo" }, User);
		// @ts-expect-error the body must be a User
		void api.post("/u").json({ id: "2" }, User);
		const bad = await api.post("/u").json({ id: "2" } as unknown as User, User).safe();
		expect((bad.error as ValidationError).stage).toBe("body");
	});
});
