import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseSpec, SpecError } from "../src/codegen/spec";

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("OpenAPI 3.0", () => {
	const spec = parseSpec(fixture("shop-3.0.json"));
	const operation = (id: string) => spec.operations.find((op) => op.operationId === id)!;

	it("reads the document", () => {
		expect(spec.version).toBe("3.0");
		expect(spec.info).toEqual({
			title: "Shop API",
			version: "1.2.0",
			description: "Demo shop used by the generator tests",
		});
		expect(spec.servers).toEqual(["https://api.shop.test/v1"]); // server variables are filled with their defaults
		expect(spec.warnings).toEqual([
			"Callbacks of createPet are ignored: they describe requests the server sends to you, which a client cannot make",
		]);
		expect(spec.operations.map((op) => `${op.method} ${op.path}`)).toEqual([
			"GET /pets",
			"POST /pets",
			"GET /pets/{petId}",
			"DELETE /pets/{petId}",
			"GET /pets/{petId}/photo",
			"POST /pets/{petId}/photo",
			"GET /pets/events",
			"POST /store/orders",
			"GET /health",
		]);
	});

	it("merges path-level and operation parameters, drops the headers the client manages", () => {
		const list = operation("listPets");
		expect(list.parameters.map((p) => `${p.in}:${p.name}${p.required ? "!" : ""}`)).toEqual([
			"header:X-Trace-Id",
			"query:limit",
			"query:status",
			"header:X-Tenant!",
		]);
		expect(list.parameters.find((p) => p.name === "status")!.schema).toEqual({
			type: "array",
			items: { $ref: "#/$defs/PetStatus" },
		});
		expect(operation("getPet").parameters).toEqual([
			{ name: "petId", in: "path", required: true, schema: { type: "integer", format: "int64" } },
		]);
		expect(operation("uploadPhoto").parameters.map((p) => p.name)).toEqual(["petId"]);
	});

	it("resolves referenced responses, request bodies and headers", () => {
		const list = operation("listPets");
		expect(list.responses.map((r) => r.status)).toEqual(["200", "default"]);
		expect(list.responses[0]!.headers).toEqual([
			{ name: "X-Total-Count", in: "header", required: false, schema: { type: "integer" }, description: "All pets" },
		]);
		expect(list.responses[1]).toMatchObject({
			description: "Any error",
			content: { "application/json": { schema: { $ref: "#/$defs/Problem" } } },
		});

		const create = operation("createPet");
		expect(create.requestBody).toEqual({
			required: true,
			content: { "application/json": { schema: { $ref: "#/$defs/NewPet" } } },
		});
	});

	it("keeps summaries, descriptions, tags and deprecation", () => {
		expect(operation("listPets")).toMatchObject({
			summary: "List pets",
			description: "Returns pets, newest first.",
			tags: ["pets"],
			deprecated: false,
		});
		expect(operation("deletePet").deprecated).toBe(true);
		expect(spec.operations.find((op) => op.path === "/health")!.operationId).toBeUndefined();
	});

	it("normalizes schemas: nullable, exclusive bounds, refs", () => {
		const newPet = spec.schemas.NewPet as any;
		expect(newPet.properties.tag).toEqual({ type: ["string", "null"] });
		expect(newPet.properties.weight).toEqual({ type: "number", exclusiveMinimum: 0 });
		expect(newPet.properties.status).toEqual({ $ref: "#/$defs/PetStatus" });
		expect(newPet.properties.labels).toEqual({ type: "object", additionalProperties: { type: "string" } });
		expect(newPet.properties.name).toEqual({ type: "string", minLength: 1, description: "Display name" });
		expect(newPet.properties).not.toHaveProperty("example");

		expect(spec.schemas.Pet).toEqual({
			allOf: [
				{ $ref: "#/$defs/NewPet" },
				{
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "integer", format: "int64" },
						createdAt: { type: "string", format: "date-time", readOnly: true },
					},
				},
			],
		});
		expect(spec.schemas.Animal).toEqual({
			oneOf: [{ $ref: "#/$defs/Dog" }, { $ref: "#/$defs/Cat" }],
			discriminator: { propertyName: "petType" },
		});
		expect(spec.schemas.PetStatus).toEqual({ type: "string", enum: ["available", "pending", "sold"] });
	});

	it("keeps media types without parameters, and the xml hints", () => {
		const order = operation("placeOrder");
		expect(Object.keys(order.requestBody!.content)).toEqual(["application/xml", "application/json"]);
		expect(spec.schemas.Order).toMatchObject({
			xml: { name: "order" },
			properties: { id: { xml: { attribute: true } }, items: { xml: { wrapped: true, name: "items" } } },
		});
		expect(Object.keys(operation("uploadPhoto").requestBody!.content)).toEqual(["multipart/form-data"]);
	});
});

describe("OpenAPI 3.1", () => {
	const spec = parseSpec(fixture("events-3.1.json"));

	it("ignores webhooks, with a warning", () => {
		expect(spec.version).toBe("3.1");
		expect(spec.warnings).toEqual([
			"Webhooks are ignored: they describe requests the server sends to you, which a client cannot make",
		]);
		expect(spec.operations.map((op) => op.operationId)).toEqual(["getEvent", "getPayload"]);
	});

	it("keeps the 3.1 schema keywords and inlines a pointer into another schema", () => {
		const event = spec.schemas.Event as any;
		expect(event.properties.kind).toEqual({ const: "created" });
		expect(event.properties.note).toEqual({ type: ["string", "null"] });
		expect(event.properties.score).toEqual({ type: "number", exclusiveMinimum: 0 });
		expect(event.properties.point).toEqual({
			type: "array",
			prefixItems: [{ type: "number" }, { type: "number" }],
			items: false,
		});
		expect(event.properties.name).toEqual({ type: "string" }); // "#/components/schemas/Event/properties/id"
	});

	it("treats contentMediaType as binary data", () => {
		const payload = spec.operations.find((op) => op.operationId === "getPayload")!;
		expect(payload.responses[0]!.content["application/octet-stream"]).toEqual({
			schema: { type: "string", format: "binary" },
		});
	});
});

describe("Swagger 2.0", () => {
	const spec = parseSpec(fixture("pets-2.0.json"));
	const operation = (id: string) => spec.operations.find((op) => op.operationId === id)!;

	it("is converted to the same model", () => {
		expect(spec.version).toBe("2.0");
		expect(spec.servers).toEqual(["https://legacy.pets.test/api", "http://legacy.pets.test/api"]);
		expect(spec.operations.map((op) => op.operationId)).toEqual([
			"listPets",
			"addPet",
			"getPet",
			"downloadPhoto",
			"uploadPhoto",
			"login",
			"exportXml",
		]);
		expect(spec.warnings).toEqual([]);
	});

	it("turns inline parameter types and collectionFormat into schemas and styles", () => {
		const params = Object.fromEntries(operation("listPets").parameters.map((p) => [p.name, p]));
		expect(params.limit).toMatchObject({
			in: "query",
			required: false,
			schema: { type: "integer", minimum: 1, maximum: 50 },
		}); // from #/parameters/limitParam
		expect(params.tags).toMatchObject({
			schema: { type: "array", items: { type: "string" } },
			style: "form",
			explode: false,
		}); // csv is Swagger's default
		expect(params.ids).toMatchObject({ style: "form", explode: true });
		expect(params.sort).toMatchObject({ style: "pipeDelimited", explode: false });
	});

	it("turns body, formData and produces/consumes into request bodies and content", () => {
		expect(operation("addPet").requestBody).toEqual({
			required: true,
			content: { "application/json": { schema: { $ref: "#/$defs/NewPet" } } },
		});

		const upload = operation("uploadPhoto");
		expect(upload.parameters.map((p) => p.name)).toEqual(["id"]); // path-level parameter
		expect(upload.requestBody).toEqual({
			required: true,
			content: {
				"multipart/form-data": {
					schema: {
						type: "object",
						properties: {
							caption: { type: "string", description: "Shown under the photo" },
							file: { type: "string", format: "binary" },
						},
						required: ["file"],
					},
				},
			},
		});
		expect(Object.keys(operation("login").requestBody!.content)).toEqual(["application/x-www-form-urlencoded"]);
		expect(operation("downloadPhoto").responses[0]!.content).toEqual({
			"image/png": { schema: { type: "string", format: "binary" } },
		});
		expect(Object.keys(operation("exportXml").responses[0]!.content)).toEqual(["application/xml"]);
	});

	it("inlines referenced responses and keeps response headers", () => {
		const get = operation("getPet");
		expect(get.responses.map((r) => r.status)).toEqual(["200", "404"]);
		expect(get.responses[1]).toMatchObject({
			description: "Not found",
			content: { "application/json": { schema: { $ref: "#/$defs/Error" } } },
		});
		expect(operation("listPets").responses[0]!.headers).toEqual([
			{ name: "X-Rate-Limit", in: "header", required: false, schema: { type: "integer" }, description: "Calls left" },
		]);
	});

	it("converts definitions: x-nullable and string discriminators", () => {
		const newPet = spec.schemas.NewPet as any;
		expect(newPet.properties.nickname).toEqual({ type: ["string", "null"] });
		expect(newPet.discriminator).toEqual({ propertyName: "kind" });
		expect((spec.schemas.Pet as any).allOf[0]).toEqual({ $ref: "#/$defs/NewPet" });
		expect((spec.schemas.Pet as any).xml).toEqual({ name: "pet" });
	});
});

describe("errors and warnings", () => {
	const minimal = (extra: object = {}) => ({
		openapi: "3.0.0",
		info: { title: "t", version: "1" },
		paths: {},
		...extra,
	});

	it("rejects documents it cannot read", () => {
		expect(() => parseSpec("nope")).toThrow(SpecError);
		expect(() => parseSpec({})).toThrow("neither `openapi` nor `swagger`");
		expect(() => parseSpec({ openapi: "4.0.0" })).toThrow('Unsupported OpenAPI version "4.0.0"');
		expect(() => parseSpec({ swagger: "1.2" })).toThrow("only 2.0");
	});

	it("explains external references", () => {
		const doc = minimal({ components: { schemas: { A: { $ref: "./other.json#/B" } } } });
		expect(() => parseSpec(doc)).toThrow(/External reference "\.\/other\.json#\/B" is not supported.*bundle/s);
	});

	it("reports unresolvable and impossible references", () => {
		expect(() =>
			parseSpec(minimal({ components: { schemas: { A: { $ref: "#/components/schemas/Missing" } } } })),
		).toThrow('Cannot resolve the reference "#/components/schemas/Missing"');
		const recursive = minimal({
			components: {
				schemas: { A: { type: "object", properties: { self: { $ref: "#/components/schemas/A/properties/self" } } } },
			},
		});
		expect(() => parseSpec(recursive)).toThrow("recursive");
	});

	it("warns about what it skips", () => {
		const spec = parseSpec(
			minimal({
				paths: {
					"/a": {
						trace: { responses: {} },
						get: {
							parameters: [
								{ name: "sid", in: "cookie", schema: { type: "string" } },
								{ name: "q", in: "query", content: { "application/json": { schema: { type: "object" } } } },
							],
							responses: {},
						},
					},
				},
			}),
		);
		expect(spec.warnings).toEqual([
			"TRACE /a is not supported and was skipped",
			'Parameter "q" is defined with `content`; it is typed from its schema but sent as plain text',
		]);
		expect(spec.operations[0]!.parameters.map((p) => p.in)).toEqual(["cookie", "query"]); // cookies stay in the model; the generator decides
	});
});
