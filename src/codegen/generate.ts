import type { JsonSchema } from "../openapi/json-schema";
import { type ContentModel, type NormalizedSpec, type OperationModel, type ParameterModel, SpecError } from "./model";
import { camelCase, identifier, NameRegistry, propertyKey } from "./names";
import { parseSpec } from "./spec";
import { declareType, docComment, schemaToType, type TypeContext } from "./types";

export interface GenerateOptions {
	/** Where the document came from; only shown in the header comment */
	source?: string;
	/** Check values at runtime against the schemas (default). `false` generates types only. */
	validate?: boolean;
	/** `tag`: `api.users.getUser` (default). `none`: `api.getUser`. */
	group?: "tag" | "none";
	/** Which one to use when an operation offers both JSON and XML (default `json`) */
	prefer?: "json" | "xml";
	/** Module the generated file imports the library from (default `@cordy/endpoint-builder`) */
	importFrom?: string;
}

export interface GenerateResult {
	/** TypeScript source of the client */
	code: string;
	/** Things that were skipped or approximated */
	warnings: string[];
}

// -------------------------------------------------------------------- source text

const FLAT_WIDTH = 100;

function flat(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(flat).join(", ")}]`;
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value).filter(([, item]) => item !== undefined);
		return entries.length === 0
			? "{}"
			: `{ ${entries.map(([key, item]) => `${propertyKey(key)}: ${flat(item)}`).join(", ")} }`;
	}
	return JSON.stringify(value) ?? "undefined";
}

/** JSON-like TypeScript source: one line when short, one entry per line otherwise */
function literal(value: unknown, level: number): string {
	const oneLine = flat(value);
	if (oneLine.length + level * 4 <= FLAT_WIDTH || typeof value !== "object" || value === null) return oneLine;
	const pad = "\t".repeat(level + 1);
	const end = "\t".repeat(level);
	if (Array.isArray(value)) return `[\n${value.map((item) => `${pad}${literal(item, level + 1)},\n`).join("")}${end}]`;
	const entries = Object.entries(value).filter(([, item]) => item !== undefined);
	return `{\n${entries.map(([key, item]) => `${pad}${propertyKey(key)}: ${literal(item, level + 1)},\n`).join("")}${end}}`;
}

const DOC_KEYS = new Set([
	"title",
	"description",
	"example",
	"examples",
	"deprecated",
	"default",
	"readOnly",
	"writeOnly",
]);
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"]);
const SCHEMA_ARRAYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const SCHEMA_VALUES = new Set([
	"items",
	"additionalProperties",
	"not",
	"contains",
	"propertyNames",
	"if",
	"then",
	"else",
]);

/** Drop what only people read (descriptions, examples, ...), so the schemas that ship stay small */
function stripDocs(schema: JsonSchema | boolean): JsonSchema | boolean {
	if (typeof schema === "boolean") return schema;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (DOC_KEYS.has(key)) continue;
		if (SCHEMA_MAPS.has(key) && typeof value === "object" && value !== null) {
			out[key] = Object.fromEntries(
				Object.entries(value).map(([name, inner]) => [name, stripDocs(inner as JsonSchema | boolean)]),
			);
		} else if (SCHEMA_ARRAYS.has(key) && Array.isArray(value)) {
			out[key] = value.map((inner) => stripDocs(inner as JsonSchema | boolean));
		} else if (SCHEMA_VALUES.has(key) && (typeof value === "object" || typeof value === "boolean") && value !== null) {
			out[key] = stripDocs(value as JsonSchema | boolean);
		} else {
			out[key] = value;
		}
	}
	return out;
}

// -------------------------------------------------------------------- media types

type Kind = "json" | "xml" | "sse" | "ndjson" | "form" | "multipart" | "text" | "binary";

const JSON_MEDIA = /^(application|text)\/(.+\+)?json$/;
const XML_MEDIA = /^(application|text)\/(.+\+)?xml$/;
const NDJSON_MEDIA = /^application\/(x-)?(ndjson|jsonl|jsonlines|json-lines)$/;

function isStringSchema(schema: JsonSchema | boolean | undefined): boolean {
	return typeof schema === "object" && (schema.type === "string" || schema.format === "binary") && !schema.enum;
}

function classify(media: string, schema: JsonSchema | boolean | undefined): Kind {
	if (NDJSON_MEDIA.test(media)) return "ndjson";
	if (JSON_MEDIA.test(media)) return "json";
	if (XML_MEDIA.test(media)) return "xml";
	if (media === "text/event-stream") return "sse";
	if (media === "application/x-www-form-urlencoded") return "form";
	if (media === "multipart/form-data") return "multipart";
	if (media === "*/*" || media === "application/*") {
		return schema === undefined || typeof schema === "boolean" || isStringSchema(schema) ? "binary" : "json";
	}
	return media.startsWith("text/") ? "text" : "binary";
}

interface Chosen {
	kind: Kind;
	media: string;
	schema: JsonSchema | boolean | undefined;
}

function pick(content: ContentModel, order: readonly Kind[]): Chosen | undefined {
	const options = Object.entries(content).map(([media, entry]) => ({
		kind: classify(media, entry.schema),
		media,
		schema: entry.schema,
	}));
	for (const kind of order) {
		const found = options.find((option) => option.kind === kind);
		if (found) return found;
	}
	return undefined;
}

// ------------------------------------------------------------------- generator

const HELPER_NAMES = [
	"Api",
	"ClientOptions",
	"ErrorsOf",
	"JsonSchemaDefs",
	"contract",
	"createApi",
	"createContractApi",
	"defineContract",
	"defs",
	"endpoint",
	"jsonSchema",
	"optional",
	"queryStyle",
	"servers",
	"unchecked",
	"xmlBody",
	"xmlResponse",
];

const SUCCESS = /^2(\d\d|XX)$/i;
const ERROR_STATUS = /^[45]\d\d$/;
const IGNORED_HEADERS = new Set(["accept", "content-type", "authorization"]);
const PATH_PARAM = /\{([^}]+)\}/g;
const SAFE_PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/;

const QUERY_STYLES: Record<string, "comma" | "space" | "pipe"> = {
	pipeDelimited: "pipe",
	spaceDelimited: "space",
};

class Generator {
	readonly warnings: string[];
	readonly validate: boolean;
	readonly group: "tag" | "none";
	readonly prefer: "json" | "xml";
	readonly used = new Set<string>();
	readonly typeNames = new Map<string, string>();
	readonly spec: NormalizedSpec;
	needsDefs = false;
	readonly ctx: TypeContext = { refName: (defName) => this.typeNames.get(defName) ?? "unknown" };

	constructor(
		spec: NormalizedSpec,
		readonly options: GenerateOptions,
	) {
		this.spec = spec;
		this.warnings = [...spec.warnings];
		this.validate = options.validate !== false;
		this.group = options.group ?? "tag";
		this.prefer = options.prefer ?? "json";
	}

	warn(message: string): void {
		if (!this.warnings.includes(message)) this.warnings.push(message);
	}

	use(name: string): string {
		this.used.add(name);
		return name;
	}

	// ---- schema expressions

	/** `jsonSchema<T>(...)` or, without validation, `unchecked<T>()` */
	schemaExpr(schema: JsonSchema | boolean, level: number): string {
		const type = schemaToType(schema, this.ctx, level);
		if (!this.validate) return `${this.use("unchecked")}<${type}>()`;
		if (typeof schema === "object" && schema.$ref !== undefined && Object.keys(schema).length === 1) {
			const name = this.typeNames.get(schema.$ref.slice("#/$defs/".length));
			if (name) return name;
		}
		this.needsDefs = true;
		return `${this.use("jsonSchema")}<${type}>(${literal(stripDocs(schema), level)}, defs)`;
	}

	/** Schemas for XML are always built from the schema: the `xml` hints are what reads and writes the text */
	xmlExpr(helper: "xmlBody" | "xmlResponse", schema: JsonSchema | boolean, level: number): string {
		this.needsDefs = true;
		const type = schemaToType(schema, this.ctx, level);
		return `${this.use(helper)}<${type}>(${literal(stripDocs(schema), level)}, defs)`;
	}

	// ---- parameters

	objectOf(params: readonly ParameterModel[]): JsonSchema {
		const properties: Record<string, JsonSchema> = {};
		const required: string[] = [];
		for (const param of params) {
			const base: JsonSchema = typeof param.schema === "boolean" ? (param.schema ? {} : { not: {} }) : param.schema;
			const schema: JsonSchema = { ...base };
			if (param.description && !schema.description) schema.description = param.description;
			if (param.deprecated) schema.deprecated = true;
			properties[param.name] = schema;
			if (param.required) required.push(param.name);
		}
		return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
	}

	queryExpr(params: readonly ParameterModel[], level: number): string {
		const styles: Record<string, "comma" | "space" | "pipe"> = {};
		for (const param of params) {
			const schema = param.schema;
			const isArray = typeof schema === "object" && (schema.type === "array" || schema.items !== undefined);
			if (isArray) {
				const style = param.style && QUERY_STYLES[param.style];
				if (style) styles[param.name] = style;
				else if ((param.style === undefined || param.style === "form") && param.explode === false)
					styles[param.name] = "comma";
				else if (param.style === "matrix" || param.style === "label" || param.style === "simple") {
					this.warn(
						`Query parameter "${param.name}" uses the unsupported style "${param.style}"; it is sent as repeated values`,
					);
				}
			} else if (
				typeof schema === "object" &&
				(schema.type === "object" || schema.properties !== undefined) &&
				param.style !== "deepObject"
			) {
				this.warn(
					`Query parameter "${param.name}" is an object with the form style; it is sent as nested brackets like deepObject (filter[a]=1)`,
				);
			}
		}
		const base = this.schemaExpr(this.objectOf(params), level);
		if (Object.keys(styles).length === 0) return base;
		return `${this.use("queryStyle")}(${base}, ${literal(styles, level)})`;
	}

	// ---- one operation

	operation(op: OperationModel, name: string, level: number): string | undefined {
		const label = `${op.method} ${op.path}`;
		const pathNames = [...op.path.matchAll(PATH_PARAM)].map((match) => match[1]!);
		const badName = pathNames.find((param) => !SAFE_PARAM.test(param));
		if (badName !== undefined) {
			this.warn(`${label} was skipped: the path parameter "${badName}" is not a valid name (letters, digits and _)`);
			return undefined;
		}

		const inner = level + 1;
		const parts: string[] = [];
		const add = (text: string) => parts.push(text);

		// path
		const declared = new Map(op.parameters.filter((p) => p.in === "path").map((p) => [p.name, p] as const));
		const pathParams: ParameterModel[] = pathNames.map(
			(param) => declared.get(param) ?? { name: param, in: "path", required: true, schema: { type: "string" } },
		);
		for (const param of pathParams) {
			const style = param.style;
			if (style === "matrix" || style === "label") this.warn(`${label}: path style "${style}" is not supported`);
			param.required = true;
		}
		if (pathParams.length > 0) add(`.params(${this.schemaExpr(this.objectOf(pathParams), inner)})`);

		// query and headers
		const query = op.parameters.filter((p) => p.in === "query");
		if (query.length > 0) add(`.query(${this.queryExpr(query, inner)})`);
		const headers = op.parameters.filter((p) => p.in === "header" && !IGNORED_HEADERS.has(p.name.toLowerCase()));
		if (headers.length > 0) add(`.headers(${this.schemaExpr(this.objectOf(headers), inner)})`);
		if (op.parameters.some((p) => p.in === "cookie"))
			this.warn(`${label}: cookie parameters are not supported; send the Cookie header yourself`);

		// request body
		if (op.requestBody) this.body(op, add, inner);

		// responses
		this.responses(op, add, inner);

		const pad = "\t".repeat(level + 1);
		const call = `endpoint.${op.method.toLowerCase()}(${JSON.stringify(op.path)})`;
		this.use("endpoint");
		return [call, ...parts.map((part) => `${pad}${part}`)].join("\n");
	}

	/** Schema of a request body; an optional body may be left out */
	bodyExpr(schema: JsonSchema | boolean, required: boolean, level: number): string {
		if (required) return this.schemaExpr(schema, level);
		if (!this.validate) return `${this.use("unchecked")}<${schemaToType(schema, this.ctx, level)} | undefined>()`;
		return `${this.use("optional")}(${this.schemaExpr(schema, level)})`;
	}

	body(op: OperationModel, add: (text: string) => void, level: number): void {
		const body = op.requestBody!;
		const order: Kind[] =
			this.prefer === "xml"
				? ["xml", "json", "form", "multipart", "text", "binary"]
				: ["json", "xml", "form", "multipart", "text", "binary"];
		const chosen = pick(body.content, order);
		if (!chosen) return;
		const schema: JsonSchema | boolean =
			chosen.schema ?? (chosen.kind === "binary" ? { type: "string", format: "binary" } : true);

		switch (chosen.kind) {
			case "json":
			case "form":
			case "multipart":
				add(`.body(${this.bodyExpr(schema, body.required, level)}, ${JSON.stringify(chosen.kind)})`);
				return;
			case "xml": {
				const expr = this.xmlExpr("xmlBody", schema, level);
				add(`.body(${body.required ? expr : `${this.use("optional")}(${expr})`})`);
				add(`.defaultHeaders({ "content-type": ${JSON.stringify(chosen.media)} })`);
				return;
			}
			case "text":
			case "binary":
				add(`.body(${this.bodyExpr(schema, body.required, level)})`);
				add(`.defaultHeaders({ "content-type": ${JSON.stringify(chosen.media)} })`);
				return;
			default:
				this.warn(`${op.method} ${op.path}: a ${chosen.media} request body is not supported and stays untyped`);
		}
	}

	responses(op: OperationModel, add: (text: string) => void, level: number): void {
		const label = `${op.method} ${op.path}`;
		const order: Kind[] =
			this.prefer === "xml"
				? ["xml", "json", "sse", "ndjson", "text", "binary"]
				: ["json", "xml", "sse", "ndjson", "text", "binary"];

		const successes = op.responses
			.filter((response) => SUCCESS.test(response.status))
			.sort((a, b) => a.status.localeCompare(b.status));
		if (successes.length > 0) {
			const choices = successes
				.map((response) => pick(response.content, order))
				.filter((c): c is Chosen => c !== undefined);
			const first = choices[0];
			if (!first) {
				add(".as<void>()");
			} else {
				const same = choices.filter((choice) => choice.kind === first.kind);
				if (same.length < choices.length)
					this.warn(`${label}: successful responses use different formats; only ${first.media} is typed`);
				this.success(first, same, add, level, label);
			}
		}

		const errors: [string, string][] = [];
		for (const response of op.responses) {
			if (!ERROR_STATUS.test(response.status)) {
				if (/^[45]XX$/i.test(response.status) && Object.keys(response.content).length > 0)
					this.warn(
						`${label}: the ${response.status} response is not typed (a range cannot be matched to one status code)`,
					);
				continue;
			}
			const chosen = pick(response.content, ["json"]);
			if (!chosen || chosen.schema === undefined || chosen.schema === true) continue;
			errors.push([response.status, this.schemaExpr(chosen.schema, level + 1)]);
		}
		if (errors.length > 0) {
			errors.sort(([a], [b]) => Number(a) - Number(b));
			const pad = "\t".repeat(level + 1);
			const end = "\t".repeat(level);
			const single = `{ ${errors.map(([status, expr]) => `${status}: ${expr}`).join(", ")} }`;
			add(
				single.length + level * 4 <= FLAT_WIDTH
					? `.errors(${single})`
					: `.errors({\n${errors.map(([status, expr]) => `${pad}${status}: ${expr},\n`).join("")}${end}})`,
			);
		}
	}

	success(first: Chosen, same: Chosen[], add: (text: string) => void, level: number, label: string): void {
		// several responses of the same format (200 and 201 with different bodies) become a union
		const schemas: (JsonSchema | boolean)[] = [];
		const seen = new Set<string>();
		for (const choice of same) {
			if (choice.schema === undefined) continue;
			const key = JSON.stringify(choice.schema);
			if (!seen.has(key)) {
				seen.add(key);
				schemas.push(choice.schema);
			}
		}
		const merged: JsonSchema | boolean | undefined =
			schemas.length === 0 ? undefined : schemas.length === 1 ? schemas[0] : { anyOf: schemas as JsonSchema[] };

		switch (first.kind) {
			case "json": {
				if (merged === undefined || merged === true) return;
				add(
					this.validate
						? `.returns(${this.schemaExpr(merged, level)})`
						: `.as<${schemaToType(merged, this.ctx, level)}>()`,
				);
				return;
			}
			case "xml": {
				add(`.defaultHeaders({ accept: ${JSON.stringify(first.media)} })`);
				add(`.responseType("text")`);
				if (merged === undefined || typeof merged === "boolean") add(".as<string>()");
				else add(`.returns(${this.xmlExpr("xmlResponse", merged, level)})`);
				return;
			}
			case "sse": {
				const plain = merged === undefined || typeof merged === "boolean" || isStringSchema(merged);
				add(plain ? ".sse()" : `.sse(${this.schemaExpr(merged, level)})`);
				return;
			}
			case "ndjson": {
				const item = merged === undefined ? true : merged;
				add(`.ndjson(${this.schemaExpr(item, level)})`);
				return;
			}
			case "text": {
				add(`.defaultHeaders({ accept: ${JSON.stringify(first.media)} })`);
				add(`.responseType("text")`);
				const plain = merged === undefined || typeof merged === "boolean" || !this.validate || isStringSchema(merged);
				add(plain ? ".as<string>()" : `.returns(${this.schemaExpr(merged, level)})`);
				return;
			}
			case "binary": {
				add(`.defaultHeaders({ accept: ${JSON.stringify(first.media)} })`);
				add(`.responseType("blob")`);
				add(".as<Blob>()");
				return;
			}
			default:
				this.warn(`${label}: the ${first.media} response is not supported and stays untyped`);
		}
	}
}

// ----------------------------------------------------------------- naming

function fallbackName(op: OperationModel): string {
	const segments = op.path
		.split("/")
		.filter(Boolean)
		.map((segment) => (segment.startsWith("{") ? `by ${segment.slice(1, -1)}` : segment));
	return camelCase([op.method.toLowerCase(), ...segments].join(" "));
}

function operationName(op: OperationModel): string {
	const fromId = op.operationId ? camelCase(op.operationId) : "";
	const name = fromId === "" ? fallbackName(op) : fromId;
	return /^\d/.test(name) ? `_${name}` : name;
}

// ------------------------------------------------------------------- public

/**
 * Turn an OpenAPI 3.0 / 3.1 or Swagger 2.0 document (parsed JSON) into the source of a typed client.
 * The result is deterministic: the same document and options always give the same text.
 *
 * @throws SpecError when the document cannot be used
 */
export function generate(input: unknown, options: GenerateOptions = {}): GenerateResult {
	const spec = parseSpec(input);
	const gen = new Generator(spec, options);
	const importFrom = options.importFrom ?? "@cordy/endpoint-builder";

	// type names
	const names = new NameRegistry(HELPER_NAMES);
	for (const defName of Object.keys(spec.schemas)) gen.typeNames.set(defName, names.claim(identifier(defName)));

	// operations -> contract tree
	interface Group {
		entries: { name: string; code: string; op: OperationModel }[];
		registry: NameRegistry;
	}
	const top: { entries: { name: string; code: string; op: OperationModel }[] } = { entries: [] };
	const topRegistry = new NameRegistry();
	const groups = new Map<string, Group>();
	const order: (string | { op: number })[] = [];
	const groupNames = new Map<string, string>();

	for (const op of spec.operations) {
		let target: Group | typeof top;
		let registry: NameRegistry;
		let level: number;
		const tag = gen.group === "tag" ? op.tags[0] : undefined;
		const groupKey = tag === undefined ? "" : camelCase(tag);
		if (groupKey !== "") {
			let key = groupNames.get(groupKey);
			if (!key) {
				key = topRegistry.claim(groupKey);
				groupNames.set(groupKey, key);
				groups.set(key, { entries: [], registry: new NameRegistry() });
				order.push(key);
			}
			const group = groups.get(key)!;
			target = group;
			registry = group.registry;
			level = 2;
		} else {
			target = top;
			registry = topRegistry;
			level = 1;
		}
		const name = registry.claim(operationName(op));
		const code = gen.operation(op, name, level);
		if (code === undefined) continue;
		target.entries.push({ name, code, op });
		if (target === top) order.push({ op: top.entries.length - 1 });
	}

	// ---- contract text
	const render = (entry: { name: string; code: string; op: OperationModel }, level: number): string => {
		const pad = "\t".repeat(level);
		const lines: string[] = [];
		if (entry.op.summary) lines.push(...entry.op.summary.trim().split(/\r?\n/));
		if (entry.op.description) {
			if (lines.length > 0) lines.push("");
			lines.push(...entry.op.description.trim().split(/\r?\n/));
		}
		if (lines.length > 0) lines.push("");
		lines.push(`\`${entry.op.method} ${entry.op.path}\``);
		if (entry.op.deprecated) lines.push("@deprecated");
		return `${docComment(lines, level)}${pad}${propertyKey(entry.name)}: ${entry.code},\n`;
	};

	let contractBody = "";
	for (const item of order) {
		if (typeof item === "string") {
			const group = groups.get(item)!;
			contractBody += `\t${propertyKey(item)}: {\n${group.entries.map((entry) => render(entry, 2)).join("")}\t},\n`;
		} else {
			contractBody += render(top.entries[item.op]!, 1);
		}
	}
	if (contractBody === "") throw new SpecError("The document has no operations to generate a client for");

	// ---- types and validators
	let types = "";
	for (const [defName, schema] of Object.entries(spec.schemas)) {
		types += `${declareType(gen.typeNames.get(defName)!, schema, gen.ctx)}\n\n`;
	}

	const defEntries = Object.entries(spec.schemas).map(([defName, schema]) => [defName, stripDocs(schema)] as const);
	let validators = "";
	if (gen.validate && defEntries.length > 0) {
		gen.use("jsonSchema");
		gen.needsDefs = true;
		for (const [defName] of defEntries) {
			const name = gen.typeNames.get(defName)!;
			validators += `export const ${name} = jsonSchema<${name}>({ $ref: ${JSON.stringify(`#/$defs/${defName}`)} }, defs);\n`;
		}
		validators += "\n";
	}
	const definitions = gen.needsDefs
		? `const defs: JsonSchemaDefs = ${literal(Object.fromEntries(defEntries), 0)};\n\n`
		: "";

	// ---- wrapper
	const servers = spec.servers;
	const absolute = servers[0] !== undefined && /^https?:\/\//.test(servers[0]);
	const wrapper = [
		"/** A ready-to-use client for this API. Pass `ClientOptions` to configure it (auth, retry, hooks, a different `baseUrl`, ...). */",
		"export function createApi<const O extends ClientOptions = {}>(options?: O): Api<typeof contract, ErrorsOf<O>> {",
		absolute
			? "\treturn createContractApi(contract, { baseUrl: servers[0], ...options } as O);"
			: "\treturn createContractApi(contract, options);",
		"}",
	].join("\n");

	// ---- imports
	const helperImports = ["jsonSchema", "optional", "queryStyle", "unchecked", "xmlBody", "xmlResponse"]
		.filter((name) => gen.used.has(name))
		.sort();
	if (gen.needsDefs) helperImports.unshift("type JsonSchemaDefs");
	const mainImports = [
		"type Api",
		"type ClientOptions",
		"createApi as createContractApi",
		"defineContract",
		"endpoint",
		"type ErrorsOf",
	];
	const importLine = (names: readonly string[], from: string): string => {
		const single = `import { ${names.join(", ")} } from ${JSON.stringify(from)};`;
		return single.length <= FLAT_WIDTH
			? single
			: `import {\n${names.map((name) => `\t${name},\n`).join("")}} from ${JSON.stringify(from)};`;
	};
	const imports = [importLine(mainImports, importFrom)];
	if (helperImports.length > 0) imports.push(importLine(helperImports, `${importFrom}/openapi`));

	const title = `${spec.info.title} ${spec.info.version}`.trim();
	const header = [
		`// Generated by @cordy/endpoint-builder${options.source ? ` from ${options.source}` : ""}. Do not edit: generate it again instead.`,
		`// ${title.replace(/\s+/g, " ")}`,
	].join("\n");

	const serversText = `/** Server URLs listed in the document */\nexport const servers = ${literal(servers, 0)} as const;\n\n`;

	const code =
		`${header}\n\n${imports.join("\n")}\n\n${serversText}${types}${definitions}${validators}` +
		`/** Every operation of the API. Bind it with \`createApi(contract, options)\` or use the \`createApi\` below. */\n` +
		`export const contract = defineContract({\n${contractBody}});\n\n${wrapper}\n`;

	return { code, warnings: gen.warnings };
}
