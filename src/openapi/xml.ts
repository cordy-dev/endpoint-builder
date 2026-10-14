import type { StandardSchemaV1 } from "../schema/standard";
import { type JsonSchema, type JsonSchemaDefs, jsonSchema, type XmlHints } from "./json-schema";

/** Malformed XML, or XML that cannot be mapped */
class XmlError extends Error {
	override readonly name = "XmlError";
}

const MAX_DEPTH = 256;
const REF_PREFIX = "#/$defs/";

// ------------------------------------------------------------------- parsing

interface XmlNode {
	/** Local name (prefix removed) */
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	text: string;
}

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g;

/** Only the five predefined entities and character references: nothing is ever looked up or fetched */
function decodeEntities(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(ENTITY, (match, body: string) => {
		switch (body) {
			case "lt":
				return "<";
			case "gt":
				return ">";
			case "amp":
				return "&";
			case "quot":
				return '"';
			case "apos":
				return "'";
		}
		const code = body.startsWith("#x") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
		return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

const localName = (name: string) => name.slice(name.indexOf(":") + 1);
const ATTRIBUTE = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/**
 * A small, safe XML reader: elements, attributes, text, CDATA, comments and processing instructions.
 * A DOCTYPE is skipped and its entities are never expanded, so there is no entity-expansion or
 * external-entity attack surface.
 */
function parseXml(source: string): XmlNode {
	const stack: XmlNode[] = [];
	let root: XmlNode | undefined;
	let i = 0;

	const addText = (text: string, decode: boolean) => {
		const parent = stack[stack.length - 1];
		if (parent) parent.text += decode ? decodeEntities(text) : text;
		else if (text.trim() !== "") throw new XmlError("Text outside of the root element");
	};

	while (i < source.length) {
		const lt = source.indexOf("<", i);
		if (lt === -1) {
			addText(source.slice(i), true);
			break;
		}
		if (lt > i) addText(source.slice(i, lt), true);

		if (source.startsWith("<!--", lt)) {
			const end = source.indexOf("-->", lt + 4);
			if (end === -1) throw new XmlError("Unterminated comment");
			i = end + 3;
		} else if (source.startsWith("<![CDATA[", lt)) {
			const end = source.indexOf("]]>", lt + 9);
			if (end === -1) throw new XmlError("Unterminated CDATA section");
			addText(source.slice(lt + 9, end), false);
			i = end + 3;
		} else if (source.startsWith("<?", lt)) {
			const end = source.indexOf("?>", lt + 2);
			if (end === -1) throw new XmlError("Unterminated processing instruction");
			i = end + 2;
		} else if (source.startsWith("<!", lt)) {
			// DOCTYPE: skip it, including an internal subset in [ ... ]
			let depth = 0;
			let j = lt + 2;
			for (; j < source.length; j++) {
				const char = source[j];
				if (char === "[") depth++;
				else if (char === "]") depth--;
				else if (char === ">" && depth <= 0) break;
			}
			if (j >= source.length) throw new XmlError("Unterminated declaration");
			i = j + 1;
		} else if (source[lt + 1] === "/") {
			const gt = source.indexOf(">", lt);
			if (gt === -1) throw new XmlError("Unterminated end tag");
			const name = localName(source.slice(lt + 2, gt).trim());
			const open = stack.pop();
			if (!open) throw new XmlError(`Unexpected end tag </${name}>`);
			if (open.name !== name) throw new XmlError(`Expected </${open.name}> but found </${name}>`);
			i = gt + 1;
		} else {
			const nameMatch = /^<([^\s/>]+)/.exec(source.slice(lt, lt + 256));
			if (!nameMatch) throw new XmlError("Malformed start tag");
			const node: XmlNode = { name: localName(nameMatch[1]!), attrs: {}, children: [], text: "" };
			let j = lt + nameMatch[0].length;
			for (;;) {
				ATTRIBUTE.lastIndex = j;
				const attribute = ATTRIBUTE.exec(source);
				if (!attribute) break;
				const rawName = attribute[1]!;
				if (rawName !== "xmlns" && !rawName.startsWith("xmlns:"))
					node.attrs[localName(rawName)] = decodeEntities(attribute[2] ?? attribute[3] ?? "");
				j = ATTRIBUTE.lastIndex;
			}
			while (/\s/.test(source[j] ?? "")) j++;
			const selfClosing = source[j] === "/";
			if (selfClosing) j++;
			if (source[j] !== ">") throw new XmlError(`Malformed start tag <${node.name}>`);
			i = j + 1;

			const parent = stack[stack.length - 1];
			if (parent) parent.children.push(node);
			else if (root) throw new XmlError("More than one root element");
			else root = node;
			if (!selfClosing) {
				if (stack.length >= MAX_DEPTH) throw new XmlError(`Elements are nested deeper than ${MAX_DEPTH} levels`);
				stack.push(node);
			}
		}
	}
	if (stack.length > 0) throw new XmlError(`Unclosed element <${stack[stack.length - 1]!.name}>`);
	if (!root) throw new XmlError("No root element");
	return root;
}

// ------------------------------------------------------------ schema helpers

interface Resolved {
	schema: JsonSchema;
	/** Name of the component schema a $ref pointed to */
	defName?: string;
}

function resolve(schema: JsonSchema, defs: JsonSchemaDefs): Resolved {
	let current = schema;
	let defName: string | undefined;
	for (let depth = 0; current.$ref !== undefined; depth++) {
		if (!current.$ref.startsWith(REF_PREFIX) || depth > 50) throw new XmlError(`Cannot resolve ${current.$ref}`);
		defName = current.$ref.slice(REF_PREFIX.length);
		const target = defs[defName];
		if (!target) throw new XmlError(`Unknown schema reference ${current.$ref}`);
		current = target;
	}
	return defName === undefined ? { schema: current } : { schema: current, defName };
}

interface ObjectShape {
	properties: Map<string, JsonSchema>;
	xml?: XmlHints;
	defName?: string;
}

/** Merge `allOf` parts into one set of properties */
function shapeOf(input: JsonSchema, defs: JsonSchemaDefs): ObjectShape {
	const { schema, defName } = resolve(input, defs);
	const shape: ObjectShape = { properties: new Map() };
	if (defName !== undefined) shape.defName = defName;
	if (schema.xml) shape.xml = schema.xml;
	for (const part of schema.allOf ?? []) {
		const inner = shapeOf(part, defs);
		for (const [name, property] of inner.properties) shape.properties.set(name, property);
		if (!shape.xml && inner.xml) shape.xml = inner.xml;
		if (shape.defName === undefined && inner.defName !== undefined) shape.defName = inner.defName;
	}
	for (const [name, property] of Object.entries(schema.properties ?? {})) shape.properties.set(name, property);
	return shape;
}

const isArraySchema = (schema: JsonSchema) =>
	schema.type === "array" ||
	(Array.isArray(schema.type) && schema.type.includes("array")) ||
	schema.items !== undefined;
const isObjectSchema = (schema: JsonSchema) =>
	schema.type === "object" || schema.properties !== undefined || schema.allOf !== undefined;

function qualified(name: string, xml: XmlHints | undefined): string {
	return xml?.prefix ? `${xml.prefix}:${name}` : name;
}

function primitiveType(schema: JsonSchema): string | undefined {
	const types = Array.isArray(schema.type)
		? schema.type.filter((type) => type !== "null")
		: schema.type === undefined
			? []
			: [schema.type];
	if (types[0] !== undefined) return types[0];
	const first = schema.enum?.find((item) => item !== null);
	return first === undefined ? undefined : typeof first;
}

// ------------------------------------------------------------- serializing

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, "&quot;");

function scalar(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	throw new XmlError(`Cannot write a ${typeof value} as XML text`);
}

function namespaceAttribute(xml: XmlHints | undefined): string {
	if (!xml?.namespace) return "";
	return xml.prefix
		? ` xmlns:${xml.prefix}="${escapeAttribute(xml.namespace)}"`
		: ` xmlns="${escapeAttribute(xml.namespace)}"`;
}

function pickBranch(value: unknown, schema: JsonSchema, defs: JsonSchemaDefs): JsonSchema {
	const branches = schema.oneOf ?? schema.anyOf;
	if (!branches) return schema;
	const matching = branches.find((branch) => {
		const result = jsonSchema(branch, defs)["~standard"].validate(value);
		return !(result instanceof Promise) && !result.issues;
	});
	return matching ?? branches[0]!;
}

/** The element(s) for one value. `name` is the property name or the root name. */
function writeValue(value: unknown, input: JsonSchema, defs: JsonSchemaDefs, name: string): string {
	if (value === undefined || value === null) return "";
	const resolved = resolve(input, defs);
	const schema = pickBranch(value, resolved.schema, defs);
	if (schema !== resolved.schema) return writeValue(value, schema, defs, name);

	if (Array.isArray(value)) {
		// root-level or nested-array fallback: wrap the items
		const items = schema.items && schema.items !== true ? schema.items : {};
		const wrapper = qualified(schema.xml?.name ?? name, schema.xml);
		return `<${wrapper}${namespaceAttribute(schema.xml)}>${value.map((item) => writeValue(item, items, defs, name)).join("")}</${wrapper}>`;
	}
	if (typeof value === "object") {
		const shape = shapeOf(input, defs);
		const element = qualified(shape.xml?.name ?? name, shape.xml);
		const object = value as Record<string, unknown>;
		let attributes = namespaceAttribute(shape.xml);
		let body = "";
		for (const [property, propertySchema] of shape.properties) {
			const child = object[property];
			if (child === undefined || child === null) continue;
			const target = resolve(propertySchema, defs).schema;
			const xml = target.xml ?? propertySchema.xml;
			if (xml?.attribute) {
				attributes += ` ${qualified(xml.name ?? property, xml)}="${escapeAttribute(scalar(child))}"`;
			} else if (Array.isArray(child)) {
				body += writeArray(child, propertySchema, defs, property);
			} else {
				body += writeValue(child, propertySchema, defs, (target.xml ?? propertySchema.xml)?.name ?? property);
			}
		}
		return body === "" ? `<${element}${attributes}/>` : `<${element}${attributes}>${body}</${element}>`;
	}

	const element = qualified(schema.xml?.name ?? name, schema.xml);
	return `<${element}${namespaceAttribute(schema.xml)}>${escapeText(scalar(value))}</${element}>`;
}

function writeArray(items: unknown[], input: JsonSchema, defs: JsonSchemaDefs, property: string): string {
	const array = resolve(input, defs).schema;
	const itemSchema = array.items && array.items !== true ? array.items : {};
	const itemTarget = resolve(itemSchema, defs).schema;
	const itemName = itemTarget.xml?.name ?? itemSchema.xml?.name;
	if (array.xml?.wrapped) {
		const wrapper = qualified(array.xml.name ?? property, array.xml);
		return `<${wrapper}${namespaceAttribute(array.xml)}>${items.map((item) => writeValue(item, itemSchema, defs, itemName ?? property)).join("")}</${wrapper}>`;
	}
	return items.map((item) => writeValue(item, itemSchema, defs, itemName ?? array.xml?.name ?? property)).join("");
}

// ----------------------------------------------------------------- reading

function readScalar(text: string, schema: JsonSchema): unknown {
	switch (primitiveType(schema)) {
		case "integer":
		case "number":
			return text.trim() === "" ? Number.NaN : Number(text.trim());
		case "boolean": {
			const normalized = text.trim().toLowerCase();
			return normalized === "true" || normalized === "1"
				? true
				: normalized === "false" || normalized === "0"
					? false
					: text;
		}
		default:
			return text;
	}
}

function isNil(node: XmlNode): boolean {
	return node.attrs.nil === "true";
}

function readNode(node: XmlNode, input: JsonSchema, defs: JsonSchemaDefs): unknown {
	if (isNil(node)) return null;
	const resolved = resolve(input, defs);
	const branches = resolved.schema.oneOf ?? resolved.schema.anyOf;
	if (branches) {
		let first: unknown;
		for (const [index, branch] of branches.entries()) {
			const candidate = readNode(node, branch, defs);
			if (index === 0) first = candidate;
			const result = jsonSchema(branch, defs)["~standard"].validate(candidate);
			if (!(result instanceof Promise) && !result.issues) return candidate;
		}
		return first;
	}

	const schema = resolved.schema;
	if (isArraySchema(schema) && !isObjectSchema(schema)) {
		const itemSchema = schema.items && schema.items !== true ? schema.items : {};
		return node.children.map((child) => readNode(child, itemSchema, defs));
	}
	if (!isObjectSchema(schema)) return readScalar(node.text, schema);

	const shape = shapeOf(input, defs);
	const result: Record<string, unknown> = {};
	for (const [property, propertySchema] of shape.properties) {
		const target = resolve(propertySchema, defs).schema;
		const xml = target.xml ?? propertySchema.xml;

		if (xml?.attribute) {
			const raw = node.attrs[xml.name ?? property];
			if (raw !== undefined) result[property] = readScalar(raw, target);
		} else if (isArraySchema(target) && !isObjectSchema(target)) {
			const itemSchema = target.items && target.items !== true ? target.items : {};
			const itemTarget = resolve(itemSchema, defs).schema;
			const itemName = itemTarget.xml?.name ?? itemSchema.xml?.name;
			if (target.xml?.wrapped) {
				const wrapper = node.children.find((child) => child.name === (target.xml?.name ?? property));
				if (wrapper)
					result[property] = wrapper.children
						.filter((child) => child.name === (itemName ?? property))
						.map((child) => readNode(child, itemSchema, defs));
			} else {
				const found = node.children.filter((child) => child.name === (itemName ?? target.xml?.name ?? property));
				if (found.length > 0) result[property] = found.map((child) => readNode(child, itemSchema, defs));
			}
		} else {
			const element = node.children.find((child) => child.name === (xml?.name ?? property));
			if (element) result[property] = readNode(element, propertySchema, defs);
		}
	}
	return result;
}

// -------------------------------------------------------------- public API

export interface XmlOptions {
	/** Name of the root element (default: the schema's `xml.name`, else the component name) */
	root?: string;
}

function rootNameOf(schema: JsonSchema, defs: JsonSchemaDefs, options: XmlOptions | undefined): string {
	if (options?.root) return options.root;
	const shape = shapeOf(schema, defs);
	return shape.xml?.name ?? shape.defName ?? "root";
}

/**
 * Read an XML response body (the text of the response) as the value `schema` describes and validate it.
 * Mapping follows the OpenAPI `xml` object: `name`, `attribute`, `wrapped`, `prefix`/`namespace`.
 * Elements the schema does not mention are ignored; `xsi:nil="true"` reads as `null`.
 */
export function xmlResponse<T = unknown>(schema: JsonSchema, defs: JsonSchemaDefs = {}): StandardSchemaV1<unknown, T> {
	const validator = jsonSchema<T>(schema, defs);
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				if (typeof value !== "string") return { issues: [{ message: `Expected XML text, received ${typeof value}` }] };
				let parsed: unknown;
				try {
					parsed = readNode(parseXml(value), schema, defs);
				} catch (error) {
					if (error instanceof XmlError) return { issues: [{ message: `Malformed XML: ${error.message}` }] };
					throw error;
				}
				return validator["~standard"].validate(parsed);
			},
		},
	};
}

/**
 * Validate a value against `schema`, then write it as XML text. Use it for request bodies with an
 * XML media type. The input type is `T`, the output (what is sent) is the XML string.
 */
export function xmlBody<T = unknown>(
	schema: JsonSchema,
	defs: JsonSchemaDefs = {},
	options?: XmlOptions,
): StandardSchemaV1<T, string> {
	const validator = jsonSchema<T>(schema, defs);
	const root = rootNameOf(schema, defs, options);
	return {
		"~standard": {
			version: 1,
			vendor: "endpoint-builder",
			validate(value) {
				const result = validator["~standard"].validate(value);
				const convert = (checked: StandardSchemaV1.Result<T>): StandardSchemaV1.Result<string> => {
					if (checked.issues) return checked;
					try {
						return { value: writeValue(checked.value, schema, defs, root) };
					} catch (error) {
						if (error instanceof XmlError) return { issues: [{ message: error.message }] };
						throw error;
					}
				};
				return result instanceof Promise ? result.then(convert) : convert(result);
			},
		},
	};
}
