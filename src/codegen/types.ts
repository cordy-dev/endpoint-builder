import type { JsonSchema } from "../openapi/json-schema";
import { propertyKey } from "./names";

export interface TypeContext {
	/** TypeScript name for the component schema called `defName` */
	refName(defName: string): string;
}

/** precedence: how tightly a type binds, to know when it needs parentheses */
interface Code {
	text: string;
	prec: 0 | 1 | 2; // union < intersection < atom
}

const atom = (text: string): Code => ({ text, prec: 2 });
const REF_PREFIX = "#/$defs/";

function paren(code: Code, min: 1 | 2): string {
	return code.prec < min ? `(${code.text})` : code.text;
}

function union(members: Code[]): Code {
	const unique = [...new Set(members.map((member) => paren(member, 1)))];
	return unique.length === 1 ? atom(unique[0]!) : { text: unique.join(" | "), prec: 0 };
}

function intersection(members: Code[]): Code {
	const unique = [...new Set(members.map((member) => paren(member, 2)))];
	return unique.length === 1 ? atom(unique[0]!) : { text: unique.join(" & "), prec: 1 };
}

function literal(value: unknown): Code {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return atom(JSON.stringify(value));
	return atom("unknown");
}

function indentOf(level: number): string {
	return "\t".repeat(level);
}

/** `/** ... *\/` block for a schema's description, `@deprecated` and `@format`. Empty when there is nothing to say. */
export function jsDoc(schema: JsonSchema | boolean, level = 0, extra: readonly string[] = []): string {
	if (typeof schema === "boolean") return "";
	const lines: string[] = [];
	if (schema.title && !schema.description) lines.push(schema.title);
	if (schema.description) lines.push(...schema.description.trim().split(/\r?\n/));
	lines.push(...extra);
	if (schema.format && schema.format !== "binary") lines.push(`@format ${schema.format}`);
	if (schema.deprecated) lines.push("@deprecated");
	if (lines.length === 0) return "";
	const pad = indentOf(level);
	const clean = lines.map((line) => line.replace(/\*\//g, "*\\/").trimEnd());
	if (clean.length === 1 && !clean[0]!.startsWith("@")) return `${pad}/** ${clean[0]} */\n`;
	return `${pad}/**\n${clean.map((line) => `${pad} * ${line}`.trimEnd()).join("\n")}\n${pad} */\n`;
}

function objectType(schema: JsonSchema, ctx: TypeContext, level: number): Code {
	const required = new Set(schema.required ?? []);
	const properties = schema.properties ?? {};
	const pad = indentOf(level + 1);
	const members: string[] = [];

	for (const [name, child] of Object.entries(properties)) {
		members.push(
			`${jsDoc(child, level + 1)}${pad}${propertyKey(name)}${required.has(name) ? "" : "?"}: ${emit(child, ctx, level + 1).text};`,
		);
	}
	for (const name of required) {
		if (!(name in properties)) members.push(`${pad}${propertyKey(name)}: unknown;`); // required here, described by another part of an allOf
	}

	const extra = schema.additionalProperties;
	if (members.length === 0) {
		if (extra === false) return atom("Record<string, never>");
		return atom(`Record<string, ${typeof extra === "object" ? emit(extra, ctx, level).text : "unknown"}>`);
	}

	const literalType = atom(`{\n${members.join("\n")}\n${indentOf(level)}}`);
	if (typeof extra === "object") {
		return intersection([literalType, atom(`{ [key: string]: ${emit(extra, ctx, level).text} }`)]);
	}
	return literalType;
}

function arrayType(schema: JsonSchema, ctx: TypeContext, level: number): Code {
	if (schema.prefixItems) {
		const items = schema.prefixItems.map((item) => emit(item, ctx, level).text);
		if (schema.items !== undefined && schema.items !== false)
			items.push(`...${paren(emit(schema.items, ctx, level), 2)}[]`);
		return atom(`[${items.join(", ")}]`);
	}
	const item = schema.items === undefined || schema.items === true ? atom("unknown") : emit(schema.items, ctx, level);
	return atom(`${paren(item, 2)}[]`);
}

function typeFor(type: string, schema: JsonSchema, ctx: TypeContext, level: number): Code {
	switch (type) {
		case "string":
			return atom(schema.format === "binary" ? "Blob" : "string");
		case "number":
		case "integer":
			return atom("number");
		case "boolean":
			return atom("boolean");
		case "null":
			return atom("null");
		case "array":
			return arrayType(schema, ctx, level);
		case "object":
			return objectType(schema, ctx, level);
		default:
			return atom("unknown");
	}
}

/** `{ type: "object" }` that only exists to host an allOf/oneOf: it adds nothing to the type */
function isEmptyObject(schema: JsonSchema): boolean {
	return (
		schema.type === "object" &&
		!schema.properties &&
		!schema.required?.length &&
		schema.additionalProperties === undefined
	);
}

function emit(schema: JsonSchema | boolean, ctx: TypeContext, level: number): Code {
	if (schema === true) return atom("unknown");
	if (schema === false) return atom("never");
	if (schema.$ref !== undefined) {
		if (!schema.$ref.startsWith(REF_PREFIX)) return atom("unknown");
		return atom(ctx.refName(schema.$ref.slice(REF_PREFIX.length)));
	}

	const combinators: Code[] = [];
	for (const member of schema.allOf ?? []) combinators.push(emit(member, ctx, level));
	const alternatives = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])].map((member) => emit(member, ctx, level));
	if (schema.oneOf && schema.anyOf) {
		combinators.push(
			union(schema.oneOf.map((member) => emit(member, ctx, level))),
			union(schema.anyOf.map((member) => emit(member, ctx, level))),
		);
	} else if (alternatives.length > 0) {
		combinators.push(union(alternatives));
	}

	let base: Code | undefined;
	if (schema.const !== undefined) base = literal(schema.const);
	else if (schema.enum) base = union(schema.enum.map(literal));
	else if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		const skipEmpty = combinators.length > 0 && isEmptyObject(schema);
		if (!skipEmpty) base = union(types.map((type) => typeFor(type, schema, ctx, level)));
	} else if (schema.properties || schema.required?.length || schema.additionalProperties !== undefined) {
		base = objectType(schema, ctx, level);
	} else if (schema.items !== undefined || schema.prefixItems) {
		base = arrayType(schema, ctx, level);
	}

	const parts = base ? [base, ...combinators] : combinators;
	if (parts.length === 0) return atom("unknown");
	return parts.length === 1 ? parts[0]! : intersection(parts);
}

/** TypeScript source for the type of values a schema accepts */
export function schemaToType(schema: JsonSchema | boolean, ctx: TypeContext, level = 0): string {
	return emit(schema, ctx, level).text;
}

/** `export interface Name { ... }` for plain objects, `export type Name = ...` for everything else, with its JSDoc */
export function declareType(name: string, schema: JsonSchema | boolean, ctx: TypeContext): string {
	const code = emit(schema, ctx, 0);
	const doc = jsDoc(schema, 0);
	const plainObject =
		typeof schema === "object" && schema.$ref === undefined && code.prec === 2 && code.text.startsWith("{");
	return plainObject ? `${doc}export interface ${name} ${code.text}` : `${doc}export type ${name} = ${code.text};`;
}
