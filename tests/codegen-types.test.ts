import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validate } from "../src";
import { NameRegistry, pascalCase } from "../src/codegen/names";
import { parseSpec } from "../src/codegen/spec";
import { declareType, schemaToType, type TypeContext } from "../src/codegen/types";
import { type JsonSchema,jsonSchema } from "../src/openapi/json-schema";
import { typecheck } from "./helpers-ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const ctx: TypeContext = { refName: name => pascalCase(name) };
const type = (schema: JsonSchema | boolean) => schemaToType(schema, ctx);

describe("schemaToType", () => {
	it("primitives, literals and enums", () => {
		expect(type({ type: "string" })).toBe("string");
		expect(type({ type: "integer" })).toBe("number");
		expect(type({ type: "number" })).toBe("number");
		expect(type({ type: "boolean" })).toBe("boolean");
		expect(type({ type: "null" })).toBe("null");
		expect(type({ type: ["string", "null"] })).toBe("string | null");
		expect(type({ type: "string", enum: ["a", "b"] })).toBe("\"a\" | \"b\"");
		expect(type({ type: ["string", "null"], enum: ["a", null] })).toBe("\"a\" | null");
		expect(type({ enum: [1, 2, true] })).toBe("1 | 2 | true");
		expect(type({ const: "created" })).toBe("\"created\"");
		expect(type({})).toBe("unknown");
		expect(type(true)).toBe("unknown");
		expect(type(false)).toBe("never");
		expect(type({ type: "string", format: "binary" })).toBe("Blob");
		expect(type({ type: "string", format: "date-time" })).toBe("string");
	});

	it("arrays and tuples", () => {
		expect(type({ type: "array", items: { type: "string" } })).toBe("string[]");
		expect(type({ type: "array", items: { type: ["string", "null"] } })).toBe("(string | null)[]");
		expect(type({ type: "array", items: { oneOf: [{ $ref: "#/$defs/Dog" }, { $ref: "#/$defs/Cat" }] } })).toBe("(Dog | Cat)[]");
		expect(type({ type: "array" })).toBe("unknown[]");
		expect(type({ type: "array", prefixItems: [{ type: "number" }, { type: "string" }], items: false })).toBe("[number, string]");
		expect(type({ type: "array", prefixItems: [{ type: "number" }], items: { type: "string" } })).toBe("[number, ...string[]]");
	});

	it("objects: required, optional, quoted keys, nesting", () => {
		expect(type({ type: "object", required: ["id"], properties: { id: { type: "integer" }, "x-tag": { type: "string" } } })).toBe(
			"{\n\tid: number;\n\t\"x-tag\"?: string;\n}",
		);
		expect(type({ type: "object", properties: { owner: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } })).toBe(
			"{\n\towner?: {\n\t\tname: string;\n\t};\n}",
		);
		expect(type({ type: "object", required: ["a"], properties: {} })).toBe("{\n\ta: unknown;\n}");
	});

	it("objects: additionalProperties", () => {
		expect(type({ type: "object" })).toBe("Record<string, unknown>");
		expect(type({ type: "object", additionalProperties: { type: "string" } })).toBe("Record<string, string>");
		expect(type({ type: "object", additionalProperties: false })).toBe("Record<string, never>");
		expect(type({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true })).toBe("{\n\ta?: string;\n}");
		expect(type({ type: "object", properties: { a: { type: "string" } }, additionalProperties: { type: "number" } })).toBe(
			"{\n\ta?: string;\n} & { [key: string]: number }",
		);
	});

	it("references and combinators", () => {
		expect(type({ $ref: "#/$defs/pet_status" })).toBe("PetStatus");
		expect(type({ allOf: [{ $ref: "#/$defs/NewPet" }, { type: "object", required: ["id"], properties: { id: { type: "integer" } } }] })).toBe(
			"NewPet & {\n\tid: number;\n}",
		);
		expect(type({ oneOf: [{ $ref: "#/$defs/Dog" }, { $ref: "#/$defs/Cat" }] })).toBe("Dog | Cat");
		expect(type({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
		expect(type({ type: "object", allOf: [{ $ref: "#/$defs/A" }] })).toBe("A"); // an empty object type adds nothing
		expect(type({ allOf: [{ $ref: "#/$defs/A" }, { oneOf: [{ $ref: "#/$defs/B" }, { $ref: "#/$defs/C" }] }] })).toBe("A & (B | C)");
		expect(type({ not: { type: "string" } })).toBe("unknown");
	});
});

describe("declareType", () => {
	it("uses an interface for plain objects and a type alias for everything else", () => {
		expect(declareType("Pet", { type: "object", required: ["id"], properties: { id: { type: "integer" } } }, ctx)).toBe("export interface Pet {\n\tid: number;\n}");
		expect(declareType("PetStatus", { type: "string", enum: ["a", "b"] }, ctx)).toBe("export type PetStatus = \"a\" | \"b\";");
		expect(declareType("Pets", { type: "array", items: { $ref: "#/$defs/Pet" } }, ctx)).toBe("export type Pets = Pet[];");
		expect(declareType("Labels", { type: "object", additionalProperties: { type: "string" } }, ctx)).toBe("export type Labels = Record<string, string>;");
		expect(declareType("Alias", { $ref: "#/$defs/Pet" }, ctx)).toBe("export type Alias = Pet;");
	});

	it("writes JSDoc from descriptions, formats and deprecation", () => {
		const code = declareType("Pet", {
			type: "object",
			description: "A pet.\nSecond line.",
			properties: {
				name: { type: "string", description: "Display name" },
				born: { type: "string", format: "date" },
				legacy: { type: "string", deprecated: true, description: "Use name" },
				evil: { type: "string", description: "ends */ here" },
			},
		}, ctx);
		expect(code).toBe([
			"/**",
			" * A pet.",
			" * Second line.",
			" */",
			"export interface Pet {",
			"\t/** Display name */",
			"\tname?: string;",
			"\t/**",
			"\t * @format date",
			"\t */",
			"\tborn?: string;",
			"\t/**",
			"\t * Use name",
			"\t * @deprecated",
			"\t */",
			"\tlegacy?: string;",
			"\t/** ends *\\/ here */",
			"\tevil?: string;",
			"}",
		].join("\n"));
	});
});

describe("names", () => {
	it("converts to Pascal and camel case", () => {
		expect(pascalCase("get_user-by.id")).toBe("GetUserById");
		expect(pascalCase("HTTPServer")).toBe("HttpServer");
		expect(pascalCase("pet2Store")).toBe("Pet2Store");
	});

	it("hands out unique names", () => {
		const names = new NameRegistry(["Taken"]);
		expect([names.claim("Pet"), names.claim("Pet"), names.claim("Taken"), names.claim("Blob")]).toEqual(["Pet", "Pet2", "Taken2", "Blob_"]);
	});
});

describe("generated types compile and agree with the validator", () => {
	function generate(specName: string) {
		const spec = parseSpec(fixture(specName));
		const names = new NameRegistry();
		const tsName = new Map(Object.keys(spec.schemas).map(name => [name, names.claim(pascalCase(name))]));
		const context: TypeContext = { refName: name => tsName.get(name)! };
		const code = Object.entries(spec.schemas).map(([name, schema]) => declareType(tsName.get(name)!, schema, context)).join("\n\n");
		const defs = spec.schemas as Record<string, JsonSchema>;
		const check = (name: string, value: unknown) => validate(jsonSchema({ $ref: `#/$defs/${name}` }, defs), value);
		return { code, check };
	}

	it("shop-3.0: every declaration is valid TypeScript with the expected shapes", () => {
		const { code } = generate("shop-3.0.json");
		const usage = `
import type { Animal, Order, Pet, NewPet, PetEvent, TreeNode, ValidationProblem } from "./types";

export const pet: Pet = { id: 1, name: "Rex", tag: null, status: "available", category: { id: 1 }, labels: { a: "b" }, weight: 3 };
// @ts-expect-error id is required on Pet
export const noId: Pet = { name: "Rex" };
// @ts-expect-error name is required on NewPet
export const noName: NewPet = { tag: "x" };
// @ts-expect-error unknown status
export const badStatus: NewPet = { name: "x", status: "gone" };
export const dog: Animal = { petType: "dog", barks: true };
// @ts-expect-error a dog does not have lives
export const mixed: Animal = { petType: "dog", lives: 9 };
export const tree: TreeNode = { name: "root", children: [{ name: "leaf" }] };
export const problem: ValidationProblem = { title: "bad", errors: [{ field: "a", message: "b" }] };
export const event: PetEvent = { type: "adopted", petId: 1 };
// @ts-expect-error unknown event type
export const badEvent: PetEvent = { type: "exploded", petId: 1 };
export const order: Order = { id: 1, items: [{ sku: "a", quantity: 2 }] };
`;
		expect(typecheck({ "types.ts": code, "usage.ts": usage })).toEqual([]);
	});

	it("events-3.1: const, nullable, tuples and inlined pointers", () => {
		const { code } = generate("events-3.1.json");
		const usage = `
import type { Event } from "./types";
export const ok: Event = { id: "e1", kind: "created", at: "2026-01-01T00:00:00Z", note: null, score: 1, point: [1, 2], name: "x" };
// @ts-expect-error kind is the literal "created"
export const wrongKind: Event = { id: "e1", kind: "deleted", at: "x" };
// @ts-expect-error point is a pair
export const wrongPoint: Event = { id: "e1", kind: "created", at: "x", point: [1, 2, 3] };
`;
		expect(typecheck({ "types.ts": code, "usage.ts": usage })).toEqual([]);
	});

	it("pets-2.0: converted definitions compile too", () => {
		const { code } = generate("pets-2.0.json");
		const usage = `
import type { NewPet, Pet } from "./types";
export const pet: Pet = { id: 1, name: "Rex", nickname: null, kind: "dog" };
// @ts-expect-error kind is dog or cat
export const wrong: NewPet = { name: "x", kind: "fish" };
`;
		expect(typecheck({ "types.ts": code, "usage.ts": usage })).toEqual([]);
	});

	it("the validator accepts exactly what the types describe", async () => {
		const { check } = generate("shop-3.0.json");
		const ok = async (name: string, value: unknown) => (await check(name, value)).success;

		expect(await ok("Pet", { id: 1, name: "Rex", tag: null, status: "sold", category: { id: 2 }, labels: { a: "b" }, weight: 1 })).toBe(true);
		expect(await ok("Pet", { name: "Rex" })).toBe(false); // id is required
		expect(await ok("Pet", { id: 1, name: "" })).toBe(false); // minLength
		expect(await ok("Pet", { id: 1, name: "Rex", status: "gone" })).toBe(false); // enum
		expect(await ok("Pet", { id: 1, name: "Rex", weight: 0 })).toBe(false); // exclusiveMinimum
		expect(await ok("Pet", { id: 1, name: "Rex", tag: 5 })).toBe(false); // nullable string
		expect(await ok("Animal", { petType: "cat", lives: 9 })).toBe(true);
		expect(await ok("Animal", { petType: "dog", lives: 9 })).toBe(false);
		expect(await ok("TreeNode", { name: "r", children: [{ name: "c", children: [{ name: "d" }] }] })).toBe(true);
		expect(await ok("TreeNode", { name: "r", children: [{ name: 1 }] })).toBe(false);
		expect(await ok("ValidationProblem", { title: "t", errors: [{ field: "f", message: "m" }] })).toBe(true);
		expect(await ok("ValidationProblem", { errors: [] })).toBe(false); // title comes from Problem via allOf
	});
});
