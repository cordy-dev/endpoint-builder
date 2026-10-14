import type { StandardSchemaV1 } from "../schema/standard";

export type JsonType = "string" | "number" | "integer" | "boolean" | "null" | "object" | "array";

/**
 * The subset of JSON Schema (draft 2020-12 / OpenAPI 3.1 flavour) that generated code uses.
 * OpenAPI 3.0's `nullable` is accepted as well, so hand-written schemas can use it.
 */
export interface JsonSchema {
	$ref?: string;
	type?: JsonType | readonly JsonType[];
	enum?: readonly unknown[];
	const?: unknown;
	nullable?: boolean;

	// strings
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	/** Annotation only: formats are not validated */
	format?: string;

	// numbers
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	multipleOf?: number;

	// arrays
	items?: JsonSchema | boolean;
	prefixItems?: readonly JsonSchema[];
	minItems?: number;
	maxItems?: number;
	uniqueItems?: boolean;

	// objects
	properties?: { readonly [name: string]: JsonSchema };
	required?: readonly string[];
	additionalProperties?: JsonSchema | boolean;
	minProperties?: number;
	maxProperties?: number;

	// combinators
	allOf?: readonly JsonSchema[];
	anyOf?: readonly JsonSchema[];
	oneOf?: readonly JsonSchema[];
	not?: JsonSchema;

	// annotations (ignored by the validator, used by the code generator)
	title?: string;
	description?: string;
	deprecated?: boolean;
	readOnly?: boolean;
	writeOnly?: boolean;
	default?: unknown;
	discriminator?: { propertyName: string; mapping?: { readonly [value: string]: string } };
	xml?: XmlHints;
}

/** OpenAPI `xml` object */
export interface XmlHints {
	name?: string;
	namespace?: string;
	prefix?: string;
	attribute?: boolean;
	wrapped?: boolean;
}

/** Named schemas that `$ref: "#/$defs/Name"` points to */
export type JsonSchemaDefs = { readonly [name: string]: JsonSchema };

type PathKey = string | number;
type Issue = StandardSchemaV1.Issue;
type Check = (value: unknown, path: readonly PathKey[], issues: Issue[]) => void;

/** Stop collecting after this many issues, so a huge invalid payload stays cheap */
const MAX_ISSUES = 100;

const REF_PREFIX = "#/$defs/";

function describe(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesType(type: JsonType, value: unknown): boolean {
	switch (type) {
		case "string": return typeof value === "string";
		case "number": return typeof value === "number" && Number.isFinite(value);
		case "integer": return typeof value === "number" && Number.isInteger(value);
		case "boolean": return typeof value === "boolean";
		case "null": return value === null;
		case "object": return isPlainObject(value);
		case "array": return Array.isArray(value);
	}
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
	if (isPlainObject(a)) {
		if (!isPlainObject(b)) return false;
		const keys = Object.keys(a);
		return keys.length === Object.keys(b).length && keys.every(key => key in b && deepEqual(a[key], b[key]));
	}
	return false;
}

function codePoints(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

function compileRegex(source: string): RegExp | undefined {
	try {
		return new RegExp(source, "u");
	} catch {
		try {
			return new RegExp(source);
		} catch {
			return undefined; // an unsupported pattern is skipped rather than failing every call
		}
	}
}

function compile(schema: JsonSchema | boolean, getDef: (name: string) => Check): Check {
	if (schema === true) return () => undefined;
	if (schema === false) return (_value, path, issues) => { issues.push({ message: "No value is allowed here", path }); };

	const checks: Check[] = [];
	const types = schema.type === undefined ? undefined : Array.isArray(schema.type) ? [...schema.type] as JsonType[] : [schema.type as JsonType];
	if (schema.nullable && types && !types.includes("null")) types.push("null");

	if (schema.$ref !== undefined) {
		if (!schema.$ref.startsWith(REF_PREFIX)) throw new TypeError(`Unsupported $ref "${schema.$ref}"; use "#/$defs/Name"`);
		const name = schema.$ref.slice(REF_PREFIX.length);
		checks.push((value, path, issues) => getDef(name)(value, path, issues));
	}

	if (schema.enum) {
		const allowed = schema.enum;
		checks.push((value, path, issues) => {
			if (!allowed.some(item => deepEqual(item, value))) {
				issues.push({ message: `Expected one of ${allowed.map(item => JSON.stringify(item)).join(", ")}`, path });
			}
		});
	}
	if ("const" in schema) {
		const expected = schema.const;
		checks.push((value, path, issues) => {
			if (!deepEqual(expected, value)) issues.push({ message: `Expected ${JSON.stringify(expected)}`, path });
		});
	}

	// keyword groups that only apply to one kind of value
	const stringChecks: Check[] = [];
	if (schema.minLength !== undefined) {
		const min = schema.minLength;
		stringChecks.push((value, path, issues) => {
			if (codePoints(value as string) < min) issues.push({ message: `Must be at least ${min} characters long`, path });
		});
	}
	if (schema.maxLength !== undefined) {
		const max = schema.maxLength;
		stringChecks.push((value, path, issues) => {
			if (codePoints(value as string) > max) issues.push({ message: `Must be at most ${max} characters long`, path });
		});
	}
	if (schema.pattern !== undefined) {
		const regex = compileRegex(schema.pattern);
		const source = schema.pattern;
		if (regex) {
			stringChecks.push((value, path, issues) => {
				if (!regex.test(value as string)) issues.push({ message: `Must match the pattern ${source}`, path });
			});
		}
	}

	const numberChecks: Check[] = [];
	const bound = (keyword: "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum", fails: (v: number, limit: number) => boolean, text: string) => {
		const limit = schema[keyword];
		if (limit === undefined) return;
		numberChecks.push((value, path, issues) => {
			if (fails(value as number, limit)) issues.push({ message: `Must be ${text} ${limit}`, path });
		});
	};
	bound("minimum", (v, l) => v < l, "at least");
	bound("maximum", (v, l) => v > l, "at most");
	bound("exclusiveMinimum", (v, l) => v <= l, "greater than");
	bound("exclusiveMaximum", (v, l) => v >= l, "less than");
	if (schema.multipleOf !== undefined) {
		const step = schema.multipleOf;
		numberChecks.push((value, path, issues) => {
			const ratio = (value as number) / step;
			if (Math.abs(ratio - Math.round(ratio)) > 1e-9) issues.push({ message: `Must be a multiple of ${step}`, path });
		});
	}

	const arrayChecks: Check[] = [];
	if (schema.minItems !== undefined) {
		const min = schema.minItems;
		arrayChecks.push((value, path, issues) => {
			if ((value as unknown[]).length < min) issues.push({ message: `Must contain at least ${min} items`, path });
		});
	}
	if (schema.maxItems !== undefined) {
		const max = schema.maxItems;
		arrayChecks.push((value, path, issues) => {
			if ((value as unknown[]).length > max) issues.push({ message: `Must contain at most ${max} items`, path });
		});
	}
	if (schema.uniqueItems) {
		arrayChecks.push((value, path, issues) => {
			const items = value as unknown[];
			for (let i = 1; i < items.length; i++) {
				if (items.slice(0, i).some(previous => deepEqual(previous, items[i]))) {
					issues.push({ message: "Items must be unique", path: [...path, i] });
					return;
				}
			}
		});
	}
	const prefix = schema.prefixItems?.map(item => compile(item, getDef));
	const rest = schema.items === undefined ? undefined : compile(schema.items, getDef);
	if (prefix || rest) {
		arrayChecks.push((value, path, issues) => {
			const items = value as unknown[];
			for (let i = 0; i < items.length && issues.length < MAX_ISSUES; i++) {
				const check = prefix && i < prefix.length ? prefix[i]! : rest;
				check?.(items[i], [...path, i], issues);
			}
		});
	}

	const objectChecks: Check[] = [];
	if (schema.required?.length) {
		const required = schema.required;
		objectChecks.push((value, path, issues) => {
			const object = value as Record<string, unknown>;
			for (const key of required) {
				if (object[key] === undefined) issues.push({ message: "Required", path: [...path, key] });
			}
		});
	}
	if (schema.minProperties !== undefined) {
		const min = schema.minProperties;
		objectChecks.push((value, path, issues) => {
			if (Object.keys(value as object).length < min) issues.push({ message: `Must have at least ${min} properties`, path });
		});
	}
	if (schema.maxProperties !== undefined) {
		const max = schema.maxProperties;
		objectChecks.push((value, path, issues) => {
			if (Object.keys(value as object).length > max) issues.push({ message: `Must have at most ${max} properties`, path });
		});
	}
	const properties = schema.properties ? Object.entries(schema.properties).map(([name, child]) => [name, compile(child, getDef)] as const) : [];
	const extra: Check | undefined = schema.additionalProperties === undefined || schema.additionalProperties === true
		? undefined
		: schema.additionalProperties === false
			? (_value, path, issues) => { issues.push({ message: "Unexpected property", path }); }
			: compile(schema.additionalProperties, getDef);
	if (properties.length > 0 || extra) {
		const known = new Set(properties.map(([name]) => name));
		objectChecks.push((value, path, issues) => {
			const object = value as Record<string, unknown>;
			for (const [name, check] of properties) {
				if (object[name] !== undefined) check(object[name], [...path, name], issues);
			}
			if (extra) {
				for (const key of Object.keys(object)) {
					if (!known.has(key) && issues.length < MAX_ISSUES) extra(object[key], [...path, key], issues);
				}
			}
		});
	}

	const kindChecks: Check = (value, path, issues) => {
		if (typeof value === "string") for (const check of stringChecks) check(value, path, issues);
		else if (typeof value === "number") for (const check of numberChecks) check(value, path, issues);
		else if (Array.isArray(value)) for (const check of arrayChecks) check(value, path, issues);
		else if (isPlainObject(value)) for (const check of objectChecks) check(value, path, issues);
	};
	if (stringChecks.length + numberChecks.length + arrayChecks.length + objectChecks.length > 0) checks.push(kindChecks);

	if (schema.allOf?.length) {
		const members = schema.allOf.map(member => compile(member, getDef));
		checks.push((value, path, issues) => {
			for (const member of members) member(value, path, issues);
		});
	}
	// oneOf is checked like anyOf: real-world specs often have overlapping branches, and rejecting a valid
	// response because two branches match would be worse than accepting it.
	for (const alternatives of [schema.anyOf, schema.oneOf]) {
		if (!alternatives?.length) continue;
		const branches = alternatives.map(branch => compile(branch, getDef));
		checks.push((value, path, issues) => {
			let closest: Issue[] | undefined;
			for (const branch of branches) {
				const found: Issue[] = [];
				branch(value, path, found);
				if (found.length === 0) return;
				if (!closest || found.length < closest.length) closest = found;
			}
			// report the closest alternative, it is the most useful error
			issues.push(...(closest ?? []));
		});
	}
	if (schema.not) {
		const inner = compile(schema.not, getDef);
		checks.push((value, path, issues) => {
			const found: Issue[] = [];
			inner(value, path, found);
			if (found.length === 0) issues.push({ message: "Must not match the excluded schema", path });
		});
	}

	const run: Check = (value, path, issues) => {
		for (const check of checks) {
			check(value, path, issues);
			if (issues.length >= MAX_ISSUES) return;
		}
	};
	if (!types) return checks.length === 0 ? () => undefined : run;

	// the type is a gate: on a mismatch report that one issue instead of a cascade of follow-ups
	const expected = types.join(" | ");
	return (value, path, issues) => {
		if (!types.some(type => matchesType(type, value))) {
			issues.push({ message: `Expected ${expected}, received ${describe(value)}`, path });
			return;
		}
		run(value, path, issues);
	};
}

/**
 * A [Standard Schema](https://standardschema.dev) from a JSON Schema. Generated clients use it to validate
 * bodies and responses without any validator library; you can use it by hand too.
 *
 * - `T` is the TypeScript type of valid values (generated code passes the matching interface).
 * - `defs` holds the named schemas that `{ $ref: "#/$defs/Name" }` points to (cycles are fine).
 * - Values are checked, never changed: no coercion, no defaults. Extra properties are allowed unless
 *   `additionalProperties: false`. `format` is an annotation and is not validated.
 *
 * ```ts
 * const User = jsonSchema<{ id: number; name: string }>({
 *   type: "object", required: ["id", "name"],
 *   properties: { id: { type: "integer" }, name: { type: "string" } },
 * });
 * api.get("/users/:id").returns(User);
 * ```
 */
export function jsonSchema<T = unknown>(schema: JsonSchema | boolean, defs: JsonSchemaDefs = {}): StandardSchemaV1<T, T> {
	const compiled = new Map<string, Check>();
	const getDef = (name: string): Check => {
		let check = compiled.get(name);
		if (!check) {
			const def = defs[name];
			if (def === undefined) throw new TypeError(`Unknown schema reference "#/$defs/${name}"`);
			check = compile(def, getDef);
			compiled.set(name, check);
		}
		return check;
	};
	const root = compile(schema, getDef);

	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				const issues: Issue[] = [];
				root(value, [], issues);
				return issues.length > 0 ? { issues } : { value: value as T };
			},
		},
	};
}
