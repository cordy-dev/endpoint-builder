import type { JsonSchema, JsonType } from "../openapi/json-schema";
import type { HttpMethod } from "../types";
import {
	type ContentModel,
	type MessageModel,
	type NormalizedSpec,
	type OperationModel,
	type ParameterLocation,
	type ParameterModel,
	type RequestBodyModel,
	type ResponseModel,
	SpecError,
	type WebhookModel,
} from "./model";
import { swagger2ToOpenApi } from "./swagger2";

export { SpecError } from "./model";

type Obj = Record<string, any>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"] as const;
const LOCATIONS: readonly string[] = ["path", "query", "header", "cookie"];
/** OpenAPI says these header parameters must be ignored: the client manages them itself */
const IGNORED_HEADERS = new Set(["accept", "content-type", "authorization"]);
const JSON_TYPES: readonly string[] = ["string", "number", "integer", "boolean", "null", "object", "array"];

function isObject(value: unknown): value is Obj {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const decodePointer = (segment: string) => decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~");

interface Context {
	doc: Obj;
	warnings: string[];
	warned: Set<string>;
}

function warn(ctx: Context, message: string): void {
	if (ctx.warned.has(message)) return;
	ctx.warned.add(message);
	ctx.warnings.push(message);
}

function resolvePointer(ctx: Context, ref: string): unknown {
	if (!ref.startsWith("#/")) {
		throw new SpecError(`External reference "${ref}" is not supported. Bundle the specification into one file first (for example with \`redocly bundle\`).`);
	}
	let current: unknown = ctx.doc;
	for (const segment of ref.slice(2).split("/")) {
		current = isObject(current) || Array.isArray(current) ? (current as Obj)[decodePointer(segment)] : undefined;
		if (current === undefined) throw new SpecError(`Cannot resolve the reference "${ref}"`);
	}
	return current;
}

/** Follow `$ref` chains of non-schema objects (parameters, responses, request bodies, ...) */
function deref(ctx: Context, node: unknown): Obj {
	let current = node;
	for (let depth = 0; isObject(current) && typeof current.$ref === "string"; depth++) {
		if (depth > 30) throw new SpecError(`Circular reference "${current.$ref}"`);
		current = resolvePointer(ctx, current.$ref);
	}
	return isObject(current) ? current : {};
}

// ------------------------------------------------------------------ schemas

const SCHEMA_REF = /^#\/components\/schemas\/([^/]+)$/;

function mediaTypeOf(contentType: string): string {
	return contentType.split(";")[0]!.trim().toLowerCase();
}

function normalizeSchema(ctx: Context, node: unknown, stack: readonly string[] = []): JsonSchema | boolean {
	if (typeof node === "boolean") return node;
	if (!isObject(node)) return {};

	if (typeof node.$ref === "string") {
		const named = SCHEMA_REF.exec(node.$ref);
		if (named) {
			const name = decodePointer(named[1]!);
			if (!isObject(ctx.doc.components?.schemas) || ctx.doc.components.schemas[name] === undefined) {
				throw new SpecError(`Cannot resolve the reference "${node.$ref}"`);
			}
			const ref: JsonSchema = { $ref: `#/$defs/${name}` };
			if (typeof node.description === "string") ref.description = node.description;
			return ref;
		}
		// a pointer into the middle of a document: inline what it points to
		if (stack.includes(node.$ref)) {
			throw new SpecError(`The reference "${node.$ref}" is recursive but does not point to a named schema in components.schemas, so it cannot be generated`);
		}
		return normalizeSchema(ctx, resolvePointer(ctx, node.$ref), [...stack, node.$ref]);
	}

	const out: JsonSchema = {};
	const next = (child: unknown) => normalizeSchema(ctx, child, stack);

	if (typeof node.type === "string" && JSON_TYPES.includes(node.type)) out.type = node.type as JsonType;
	else if (Array.isArray(node.type)) {
		const types = node.type.filter((type: unknown) => typeof type === "string" && JSON_TYPES.includes(type)) as JsonType[];
		if (types.length > 0) out.type = types.length === 1 ? types[0]! : types;
	}
	if (Array.isArray(node.enum)) out.enum = [...node.enum];
	if ("const" in node) out.const = node.const;
	if (typeof node.format === "string") out.format = node.format;
	// 3.1 describes binary data with contentMediaType instead of `format: binary`
	if (out.type === "string" && typeof node.contentMediaType === "string" && node.contentEncoding === undefined) out.format = "binary";
	if (out.type === "string" && node.contentEncoding === "base64") out.format = "byte";

	for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "multipleOf", "minimum", "maximum"] as const) {
		if (typeof node[key] === "number") out[key] = node[key];
	}
	if (typeof node.pattern === "string") out.pattern = node.pattern;
	if (node.uniqueItems === true) out.uniqueItems = true;
	for (const key of ["title", "description"] as const) {
		if (typeof node[key] === "string") out[key] = node[key];
	}
	for (const key of ["deprecated", "readOnly", "writeOnly"] as const) {
		if (node[key] === true) out[key] = true;
	}

	// exclusiveMinimum/Maximum: boolean modifiers in 3.0, numbers in 3.1
	for (const [exclusive, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]] as const) {
		if (typeof node[exclusive] === "number") out[exclusive] = node[exclusive];
		else if (node[exclusive] === true && typeof node[bound] === "number") {
			out[exclusive] = node[bound];
			delete out[bound];
		}
	}

	if (Array.isArray(node.required)) out.required = node.required.filter((name: unknown) => typeof name === "string");
	if (isObject(node.properties)) {
		out.properties = Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, next(child)])) as Record<string, JsonSchema>;
	}
	if (typeof node.additionalProperties === "boolean" || isObject(node.additionalProperties)) {
		out.additionalProperties = next(node.additionalProperties);
	}
	if (Array.isArray(node.items)) out.prefixItems = node.items.map(next) as JsonSchema[]; // tuple form
	else if (node.items !== undefined) out.items = next(node.items);
	if (Array.isArray(node.prefixItems)) out.prefixItems = node.prefixItems.map(next) as JsonSchema[];
	for (const key of ["allOf", "anyOf", "oneOf"] as const) {
		if (Array.isArray(node[key])) out[key] = node[key].map(next) as JsonSchema[];
	}
	if (node.not !== undefined) out.not = next(node.not) as JsonSchema;

	if (isObject(node.discriminator) && typeof node.discriminator.propertyName === "string") {
		out.discriminator = { propertyName: node.discriminator.propertyName };
		if (isObject(node.discriminator.mapping)) out.discriminator.mapping = node.discriminator.mapping;
	}
	if (isObject(node.xml)) {
		const xml: NonNullable<JsonSchema["xml"]> = {};
		if (typeof node.xml.name === "string") xml.name = node.xml.name;
		if (typeof node.xml.namespace === "string") xml.namespace = node.xml.namespace;
		if (typeof node.xml.prefix === "string") xml.prefix = node.xml.prefix;
		if (node.xml.attribute === true) xml.attribute = true;
		if (node.xml.wrapped === true) xml.wrapped = true;
		out.xml = xml;
	}
	if (isObject(node.$defs)) warn(ctx, "Local $defs inside a schema are not supported and were ignored");

	// OpenAPI 3.0 `nullable` -> an explicit null alternative
	if (node.nullable === true) {
		if (out.type !== undefined) {
			const types = Array.isArray(out.type) ? [...out.type] : [out.type];
			if (!types.includes("null")) types.push("null");
			out.type = types;
			if (out.enum && !out.enum.includes(null)) out.enum = [...out.enum, null];
		} else {
			return { anyOf: [out, { type: "null" }] };
		}
	}
	return out;
}

// ------------------------------------------------------- parameters, bodies

function parseContent(ctx: Context, content: unknown): ContentModel {
	const out: ContentModel = {};
	if (!isObject(content)) return out;
	for (const [contentType, media] of Object.entries(content)) {
		const type = mediaTypeOf(contentType);
		out[type] = isObject(media) && media.schema !== undefined ? { schema: normalizeSchema(ctx, media.schema) } : {};
	}
	return out;
}

function parseParameter(ctx: Context, node: unknown, location?: ParameterLocation): ParameterModel | undefined {
	const parameter = deref(ctx, node);
	const where = location ?? parameter.in;
	if (typeof parameter.name !== "string" || typeof where !== "string") return undefined;
	if (!LOCATIONS.includes(where)) {
		warn(ctx, `Parameter "${parameter.name}" in "${String(where)}" is not supported and was skipped`);
		return undefined;
	}
	if (where === "header" && IGNORED_HEADERS.has(parameter.name.toLowerCase())) return undefined;

	let schema: JsonSchema | boolean = {};
	if (parameter.schema !== undefined) schema = normalizeSchema(ctx, parameter.schema);
	else if (isObject(parameter.content)) {
		const [first] = Object.values(parameter.content);
		if (isObject(first) && first.schema !== undefined) schema = normalizeSchema(ctx, first.schema);
		warn(ctx, `Parameter "${parameter.name}" is defined with \`content\`; it is typed from its schema but sent as plain text`);
	}

	const model: ParameterModel = {
		name: parameter.name,
		in: where as ParameterLocation,
		required: where === "path" ? true : parameter.required === true,
		schema,
	};
	if (typeof parameter.description === "string") model.description = parameter.description;
	if (parameter.deprecated === true) model.deprecated = true;
	if (typeof parameter.style === "string") model.style = parameter.style;
	if (typeof parameter.explode === "boolean") model.explode = parameter.explode;
	return model;
}

function parseParameters(ctx: Context, list: unknown): ParameterModel[] {
	if (!Array.isArray(list)) return [];
	return list.map(item => parseParameter(ctx, item)).filter((p): p is ParameterModel => p !== undefined);
}

function parseRequestBody(ctx: Context, node: unknown): RequestBodyModel | undefined {
	if (node === undefined) return undefined;
	const body = deref(ctx, node);
	const model: RequestBodyModel = { required: body.required === true, content: parseContent(ctx, body.content) };
	if (typeof body.description === "string") model.description = body.description;
	return model;
}

function parseResponses(ctx: Context, node: unknown): ResponseModel[] {
	if (!isObject(node)) return [];
	const out: ResponseModel[] = [];
	for (const [status, raw] of Object.entries(node)) {
		if (status.startsWith("x-")) continue;
		const response = deref(ctx, raw);
		const headers: ParameterModel[] = [];
		if (isObject(response.headers)) {
			for (const [name, header] of Object.entries(response.headers)) {
				if (IGNORED_HEADERS.has(name.toLowerCase())) continue;
				const parsed = parseParameter(ctx, { ...deref(ctx, header), name }, "header");
				if (parsed) headers.push(parsed);
			}
		}
		const model: ResponseModel = { status, content: parseContent(ctx, response.content), headers };
		if (typeof response.description === "string") model.description = response.description;
		out.push(model);
	}
	return out;
}

function parseMessage(ctx: Context, node: Obj, inherited: ParameterModel[]): MessageModel {
	const own = parseParameters(ctx, node.parameters);
	const parameters = [...inherited.filter(p => !own.some(q => q.in === p.in && q.name === p.name)), ...own];
	const message: MessageModel = {
		deprecated: node.deprecated === true,
		tags: Array.isArray(node.tags) ? node.tags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
		parameters,
		responses: parseResponses(ctx, node.responses),
	};
	if (typeof node.summary === "string") message.summary = node.summary;
	if (typeof node.description === "string") message.description = node.description;
	const body = parseRequestBody(ctx, node.requestBody);
	if (body) message.requestBody = body;
	return message;
}

// ------------------------------------------------------ callbacks, webhooks

/** Flatten `{ expression: PathItem }` (callbacks) or a single PathItem (webhooks) into webhook models */
function parsePathItemAsWebhooks(ctx: Context, name: string, expression: string | undefined, rawItem: unknown, operationId?: string): WebhookModel[] {
	const item = deref(ctx, rawItem);
	const inherited = parseParameters(ctx, item.parameters);
	const out: WebhookModel[] = [];
	for (const method of METHODS) {
		if (!isObject(item[method])) continue;
		const webhook: WebhookModel = { ...parseMessage(ctx, item[method], inherited), name, method: method.toUpperCase() as HttpMethod };
		if (expression !== undefined) webhook.expression = expression;
		if (operationId !== undefined) webhook.operationId = operationId;
		out.push(webhook);
	}
	return out;
}

function parseCallbacks(ctx: Context, node: unknown, operationId?: string): WebhookModel[] {
	if (!isObject(node)) return [];
	const out: WebhookModel[] = [];
	for (const [name, rawCallback] of Object.entries(node)) {
		const callback = deref(ctx, rawCallback);
		for (const [expression, item] of Object.entries(callback)) {
			if (expression.startsWith("x-")) continue;
			out.push(...parsePathItemAsWebhooks(ctx, name, expression, item, operationId));
		}
	}
	return out;
}

// -------------------------------------------------------------- the document

function parseServers(ctx: Context): string[] {
	const servers = ctx.doc.servers;
	if (!Array.isArray(servers)) return [];
	return servers
		.filter((server): server is Obj => isObject(server) && typeof server.url === "string")
		.map(server => (server.url as string).replace(/\{([^}]+)\}/g, (match, name: string) => {
			const fallback = server.variables?.[name]?.default;
			return typeof fallback === "string" ? fallback : match;
		}));
}

/**
 * Read an OpenAPI 3.0 / 3.1 or Swagger 2.0 document (already parsed from JSON) into a uniform model.
 * Schemas are normalized to JSON Schema 2020-12 style: `nullable` becomes a `null` type, boolean
 * `exclusiveMinimum` becomes a number, component references become `#/$defs/Name`.
 *
 * @throws SpecError when the document is not usable
 */
export function parseSpec(input: unknown): NormalizedSpec {
	if (!isObject(input)) throw new SpecError("The specification must be a JSON object");
	const warnings: string[] = [];

	let version: NormalizedSpec["version"];
	let doc: Obj;
	if (input.swagger !== undefined) {
		if (String(input.swagger) !== "2.0") throw new SpecError(`Unsupported Swagger version "${String(input.swagger)}" (only 2.0)`);
		version = "2.0";
		doc = swagger2ToOpenApi(input, warnings);
	} else if (typeof input.openapi === "string") {
		if (/^3\.0\./.test(input.openapi)) version = "3.0";
		else if (/^3\.1\./.test(input.openapi)) version = "3.1";
		else throw new SpecError(`Unsupported OpenAPI version "${input.openapi}" (supported: 2.0, 3.0.x, 3.1.x)`);
		doc = input;
	} else {
		throw new SpecError("Not an OpenAPI or Swagger document: neither `openapi` nor `swagger` was found");
	}

	const ctx: Context = { doc, warnings, warned: new Set(warnings) };

	const schemas: NormalizedSpec["schemas"] = {};
	if (isObject(doc.components?.schemas)) {
		for (const [name, schema] of Object.entries(doc.components.schemas)) schemas[name] = normalizeSchema(ctx, schema);
	}

	const operations: OperationModel[] = [];
	for (const [path, rawItem] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
		if (path.startsWith("x-")) continue;
		const item = deref(ctx, rawItem);
		const inherited = parseParameters(ctx, item.parameters);
		if (isObject(item.trace)) warn(ctx, `TRACE ${path} is not supported and was skipped`);
		for (const method of METHODS) {
			const op = item[method];
			if (!isObject(op)) continue;
			const operation: OperationModel = {
				...parseMessage(ctx, op, inherited),
				method: method.toUpperCase() as HttpMethod,
				path,
				callbacks: [],
			};
			if (typeof op.operationId === "string") operation.operationId = op.operationId;
			operation.callbacks = parseCallbacks(ctx, op.callbacks, operation.operationId);
			operations.push(operation);
		}
	}

	const webhooks: WebhookModel[] = [];
	if (isObject(doc.webhooks)) {
		for (const [name, item] of Object.entries(doc.webhooks)) webhooks.push(...parsePathItemAsWebhooks(ctx, name, undefined, item));
	}

	const info = isObject(doc.info) ? doc.info : {};
	const spec: NormalizedSpec = {
		version,
		info: { title: typeof info.title === "string" ? info.title : "API", version: typeof info.version === "string" ? info.version : "0" },
		servers: parseServers(ctx),
		schemas,
		operations,
		webhooks,
		warnings,
	};
	if (typeof info.description === "string") spec.info.description = info.description;
	return spec;
}
