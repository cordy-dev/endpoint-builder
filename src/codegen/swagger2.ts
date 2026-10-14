import { SpecError } from "./model";

type Obj = Record<string, any>;

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch"] as const;
const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];
const INLINE_KEYS = [
	"type", "format", "enum", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength",
	"pattern", "minItems", "maxItems", "uniqueItems", "multipleOf",
];

function isObject(value: unknown): value is Obj {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteRef(ref: string): string {
	return ref.startsWith("#/definitions/") ? `#/components/schemas/${ref.slice("#/definitions/".length)}` : ref;
}

/** Schema object of Swagger 2.0 -> OpenAPI 3.0 */
function convertSchema(node: unknown): unknown {
	if (!isObject(node)) return node;
	const out: Obj = {};
	for (const [key, value] of Object.entries(node)) {
		switch (key) {
			case "$ref": out.$ref = typeof value === "string" ? rewriteRef(value) : value; break;
			case "properties":
				out.properties = isObject(value) ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, convertSchema(child)])) : value;
				break;
			case "items":
			case "additionalProperties":
			case "not":
				out[key] = convertSchema(value);
				break;
			case "allOf":
			case "anyOf":
			case "oneOf":
				out[key] = Array.isArray(value) ? value.map(convertSchema) : value;
				break;
			case "x-nullable": if (value === true) out.nullable = true; break;
			case "discriminator": out.discriminator = typeof value === "string" ? { propertyName: value } : value; break;
			case "example": case "x-example": break;
			default: if (!key.startsWith("x-")) out[key] = value;
		}
	}
	if (out.type === "file") {
		out.type = "string";
		out.format = "binary";
	}
	return out;
}

/** Non-body parameters and response headers carry their type inline, not in a `schema` */
function inlineSchema(node: Obj): Obj {
	const schema: Obj = {};
	for (const key of INLINE_KEYS) if (node[key] !== undefined) schema[key] = node[key];
	if (node.items !== undefined) schema.items = inlineSchema(isObject(node.items) ? node.items : {});
	if (node["x-nullable"] === true) schema.nullable = true;
	if (schema.type === "file") {
		schema.type = "string";
		schema.format = "binary";
	}
	return schema;
}

/** Swagger's collectionFormat -> OpenAPI style/explode. Swagger's default (csv) differs from OpenAPI 3's. */
function collectionStyle(parameter: Obj, location: string, warnings: string[]): { style?: string; explode?: boolean } {
	if (parameter.type !== "array") return {};
	const format = parameter.collectionFormat ?? "csv";
	const query = location === "query";
	switch (format) {
		case "csv": return query ? { style: "form", explode: false } : { style: "simple", explode: false };
		case "multi": return { style: "form", explode: true };
		case "ssv": return { style: "spaceDelimited", explode: false };
		case "pipes": return { style: "pipeDelimited", explode: false };
		default:
			warnings.push(`Parameter "${parameter.name}" uses collectionFormat "${format}", which has no OpenAPI 3 equivalent; treated as csv`);
			return query ? { style: "form", explode: false } : { style: "simple", explode: false };
	}
}

/**
 * Convert a Swagger 2.0 document to OpenAPI 3.0. `$ref`s to `parameters` and `responses` are
 * inlined, `definitions` become `components.schemas`.
 */
export function swagger2ToOpenApi(doc: Obj, warnings: string[]): Obj {
	const lookup = (kind: "parameters" | "responses", node: unknown): Obj => {
		let current = node;
		for (let depth = 0; isObject(current) && typeof current.$ref === "string"; depth++) {
			const match = new RegExp(`^#/${kind}/(.+)$`).exec(current.$ref);
			const target = match ? doc[kind]?.[decodeURIComponent(match[1]!)] : undefined;
			if (!target || depth > 20) throw new SpecError(`Cannot resolve ${String(current.$ref)}`);
			current = target;
		}
		return isObject(current) ? current : {};
	};

	const globalConsumes: string[] = Array.isArray(doc.consumes) ? doc.consumes : ["application/json"];
	const globalProduces: string[] = Array.isArray(doc.produces) ? doc.produces : ["application/json"];

	const servers: { url: string }[] = [];
	const basePath = typeof doc.basePath === "string" ? doc.basePath.replace(/\/$/, "") : "";
	if (typeof doc.host === "string") {
		const schemes: string[] = Array.isArray(doc.schemes) && doc.schemes.length > 0 ? doc.schemes : ["https"];
		for (const scheme of schemes) servers.push({ url: `${scheme}://${doc.host}${basePath}` });
	} else if (basePath) {
		servers.push({ url: basePath });
	}

	const paths: Obj = {};
	for (const [path, rawItem] of Object.entries<unknown>(doc.paths ?? {})) {
		if (path.startsWith("x-") || !isObject(rawItem)) continue;
		const item: Obj = rawItem;
		const pathParameters: Obj[] = (item.parameters ?? []).map((p: unknown) => lookup("parameters", p));
		const converted: Obj = {};

		for (const method of METHODS) {
			const op = item[method];
			if (!isObject(op)) continue;

			const own: Obj[] = (op.parameters ?? []).map((p: unknown) => lookup("parameters", p));
			const merged = [...pathParameters.filter(p => !own.some(q => q.in === p.in && q.name === p.name)), ...own];
			const consumes: string[] = Array.isArray(op.consumes) ? op.consumes : globalConsumes;
			const produces: string[] = Array.isArray(op.produces) ? op.produces : globalProduces;

			const result: Obj = { ...op, parameters: [] as Obj[] };
			delete result.consumes;
			delete result.produces;
			delete result.schemes;

			const formData: Obj[] = [];
			for (const parameter of merged) {
				if (parameter.in === "body") {
					const media = consumes.length > 0 ? consumes : ["application/json"];
					result.requestBody = {
						required: parameter.required === true,
						description: parameter.description,
						content: Object.fromEntries(media.map(type => [type, { schema: convertSchema(parameter.schema ?? {}) }])),
					};
				} else if (parameter.in === "formData") {
					formData.push(parameter);
				} else {
					result.parameters.push({
						name: parameter.name,
						in: parameter.in,
						required: parameter.in === "path" ? true : parameter.required === true,
						description: parameter.description,
						deprecated: parameter["x-deprecated"] === true ? true : undefined,
						schema: inlineSchema(parameter),
						...collectionStyle(parameter, parameter.in, warnings),
					});
				}
			}

			if (formData.length > 0) {
				const hasFile = formData.some(p => p.type === "file");
				const declared = consumes.filter(type => FORM_TYPES.includes(type));
				const media = declared.length > 0 ? declared : [hasFile ? "multipart/form-data" : "application/x-www-form-urlencoded"];
				const schema = {
					type: "object",
					properties: Object.fromEntries(formData.map(p => [p.name, { ...inlineSchema(p), description: p.description }])),
					required: formData.filter(p => p.required === true).map(p => p.name),
				};
				result.requestBody = { required: schema.required.length > 0, content: Object.fromEntries(media.map(type => [type, { schema }])) };
			}

			const responses: Obj = {};
			for (const [status, raw] of Object.entries<unknown>(op.responses ?? {})) {
				if (status.startsWith("x-")) continue;
				const response = lookup("responses", raw);
				const headers = isObject(response.headers)
					? Object.fromEntries(Object.entries<Obj>(response.headers).map(([name, header]) => [name, { description: header.description, schema: inlineSchema(header) }]))
					: undefined;
				responses[status] = {
					description: response.description ?? "",
					headers,
					content: response.schema === undefined
						? undefined
						: Object.fromEntries((produces.length > 0 ? produces : ["application/json"]).map(type => [type, { schema: convertSchema(response.schema) }])),
				};
			}
			result.responses = responses;
			converted[method] = result;
		}
		paths[path] = converted;
	}

	return {
		openapi: "3.0.3",
		info: doc.info ?? { title: "API", version: "0" },
		servers,
		tags: doc.tags,
		paths,
		components: {
			schemas: isObject(doc.definitions)
				? Object.fromEntries(Object.entries(doc.definitions).map(([name, schema]) => [name, convertSchema(schema)]))
				: {},
		},
	};
}
