import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";

import { HttpError, isHttpError, ValidationError } from "../src";
import { generate, type GenerateOptions } from "../src/codegen";
import { createApi as createPets } from "./generated/pets";
import { createApi as createShop, type Pet } from "./generated/shop";
import { createApi as createShopFlat } from "./generated/shop-flat";
import { createApi as createShopXml } from "./generated/shop-xml";
import { json, mockFetch, readBody, sseResponse } from "./helpers";
import { typecheck } from "./helpers-ts";

const LIBRARY = {
	"@cordy/endpoint-builder": resolve("src/index.ts"),
	"@cordy/endpoint-builder/openapi": resolve("src/openapi/index.ts"),
};

const fixture = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/${name}.json`, "utf8"));

// Golden files: the generated clients are committed under tests/generated and type-checked with the rest of the tests.
// After changing the generator run `UPDATE_GOLDEN=1 bun run test` to rewrite them, and read the diff.
const GOLDEN: [file: string, spec: string, options: GenerateOptions][] = [
	["shop", "shop-3.0", {}],
	["shop-xml", "shop-3.0", { prefer: "xml" }],
	["shop-flat", "shop-3.0", { group: "none", validate: false }],
	["events", "events-3.1", {}],
	["pets", "pets-2.0", {}],
];

describe("generated clients match the generator", () => {
	it.each(GOLDEN)("%s", (file, spec, options) => {
		const { code } = generate(fixture(spec), { source: `tests/fixtures/${spec}.json`, ...options });
		const path = `tests/generated/${file}.ts`;
		if (process.env.UPDATE_GOLDEN) writeFileSync(path, code);
		expect(code).toBe(readFileSync(path, "utf8"));
	});
});

const petJson = { id: 7, name: "Rex", status: "available" };
const problem = { title: "Not found", status: 404 };

describe("shop (OpenAPI 3.0, validated)", () => {
	it("uses the first server as base URL and builds typed requests", async () => {
		const fetch = mockFetch(json([petJson]));
		const api = createShop({ fetch });
		const pets = await api.pets.listPets({
			query: { limit: 2, status: ["available", "sold"] },
			headers: { "X-Tenant": "acme" },
		});
		expectTypeOf(pets).toEqualTypeOf<Pet[]>();
		const call = fetch.calls[0]!;
		expect(call.url).toBe("https://api.shop.test/v1/pets?limit=2&status=available&status=sold");
		expect(call.headers.get("x-tenant")).toBe("acme");
	});

	it("requires what the document requires", async () => {
		const api = createShop({ fetch: mockFetch(json([])) });
		// @ts-expect-error the X-Tenant header is required
		const missing = api.pets.listPets({ query: {} });
		await expect(missing).rejects.toBeInstanceOf(ValidationError);
		// @ts-expect-error petId is a number
		api.pets.getPet({ params: { petId: "x" } });
		// @ts-expect-error "gone" is not a status
		api.pets.listPets({ query: { status: ["gone"] }, headers: { "X-Tenant": "t" } });
	});

	it("validates requests before sending them", async () => {
		const fetch = mockFetch(json(petJson));
		const api = createShop({ fetch });
		const { error } = await api.pets.createPet({ body: { name: "" } }).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("validates responses", async () => {
		const api = createShop({ fetch: mockFetch(json({ id: "nope" })), retry: false });
		const { error } = await api.pets.getPet({ params: { petId: 7 } }).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).stage).toBe("response");
	});

	it("types declared error bodies", async () => {
		const fetch = mockFetch(json(problem, { status: 404 }));
		const api = createShop({ fetch, retry: false });
		const { error } = await api.pets.getPet({ params: { petId: 1 } }).safe();
		expect(error).toBeInstanceOf(HttpError);
		if (isHttpError(error, 404)) {
			expectTypeOf(error.body.title).toEqualTypeOf<string>();
			expect(error.body).toEqual(problem);
		} else {
			expect.unreachable();
		}
		expect(fetch.calls[0]!.url).toBe("https://api.shop.test/v1/pets/1");
	});

	it("sends multipart bodies", async () => {
		const fetch = mockFetch(new Response(null, { status: 204 }));
		const api = createShop({ fetch });
		const result = await api.pets.uploadPhoto({
			params: { petId: 3 },
			body: { file: new Blob(["abc"], { type: "image/png" }), caption: "hi" },
		});
		expectTypeOf(result).toEqualTypeOf<void>();
		const body = fetch.calls[0]!.body as FormData;
		expect(body).toBeInstanceOf(FormData);
		expect(body.get("caption")).toBe("hi");
		expect((body.get("file") as File).size).toBe(3);
	});

	it("downloads binary responses as Blob", async () => {
		const fetch = mockFetch(new Response("PNG", { headers: { "content-type": "image/png" } }));
		const blob = await createShop({ fetch }).pets.downloadPhoto({ params: { petId: 3 } });
		expectTypeOf(blob).toEqualTypeOf<Blob>();
		expect(await blob.text()).toBe("PNG");
		expect(fetch.calls[0]!.headers.get("accept")).toBe("image/png");
	});

	it("streams server-sent events with a typed payload", async () => {
		const fetch = mockFetch(() =>
			sseResponse(['data: {"type":"created","petId":1}\n\n', 'data: {"type":"adopted","petId":2}\n\n']),
		);
		const stream = await createShop({ fetch }).pets.streamPetEvents();
		const seen: unknown[] = [];
		for await (const event of stream) {
			expectTypeOf(event.petId).toEqualTypeOf<number>();
			seen.push(event);
		}
		expect(seen).toEqual([
			{ type: "created", petId: 1 },
			{ type: "adopted", petId: 2 },
		]);
	});

	it("reads text responses", async () => {
		const fetch = mockFetch(new Response("ok", { headers: { "content-type": "text/plain" } }));
		const text = await createShop({ fetch }).getHealth();
		expectTypeOf(text).toEqualTypeOf<string>();
		expect(text).toBe("ok");
	});

	it("reads XML responses through the xml hints", async () => {
		const xml = '<order id="5"><items><item sku="a"><quantity>2</quantity></item></items><note>hi</note></order>';
		const fetch = mockFetch(new Response(xml, { headers: { "content-type": "application/xml" } }));
		const order = await createShop({ fetch }).store.placeOrder({ body: { id: 5, items: [{ sku: "a", quantity: 2 }] } });
		expect(order).toEqual({ id: 5, items: [{ sku: "a", quantity: 2 }], note: "hi" });
		const call = fetch.calls[0]!;
		expect(call.headers.get("accept")).toBe("application/xml");
		expect(call.headers.get("content-type")).toBe("application/json");
		expect(JSON.parse(await readBody(call.body))).toEqual({ id: 5, items: [{ sku: "a", quantity: 2 }] });
	});

	it("lets the caller override the base URL and add client options", async () => {
		const fetch = mockFetch(json(petJson));
		const api = createShop({ fetch, baseUrl: "http://localhost:4000", headers: { "x-app": "1" } });
		await api.pets.getPet({ params: { petId: 1 } });
		expect(fetch.calls[0]!.url).toBe("http://localhost:4000/pets/1");
		expect(fetch.calls[0]!.headers.get("x-app")).toBe("1");
	});
});

describe("shop with --prefer xml", () => {
	it("writes the request body as XML", async () => {
		const xml = '<order id="5"><items/></order>';
		const fetch = mockFetch(new Response(xml, { headers: { "content-type": "application/xml" } }));
		await createShopXml({ fetch }).store.placeOrder({
			body: { id: 5, items: [{ sku: "a", quantity: 2 }, { sku: "b&c" }] },
		});
		const call = fetch.calls[0]!;
		expect(call.headers.get("content-type")).toBe("application/xml");
		expect(await readBody(call.body)).toBe(
			'<order id="5"><items><item sku="a"><quantity>2</quantity></item><item sku="b&amp;c"/></items></order>',
		);
	});
});

describe("shop without validation and groups", () => {
	it("keeps the types and sends anything", async () => {
		const fetch = mockFetch(json({ whatever: true }));
		const api = createShopFlat({ fetch });
		// no validation: the invalid name goes out as it is
		const data = await api.createPet({ body: { name: "" } });
		expectTypeOf(data).toEqualTypeOf<Pet>();
		expect(JSON.parse(await readBody(fetch.calls[0]!.body))).toEqual({ name: "" });
		// @ts-expect-error the types still apply
		api.createPet({ body: { name: 1 } });
	});

	it("does not import the validator", () => {
		const source = readFileSync("tests/generated/shop-flat.ts", "utf8");
		expect(source).not.toContain("jsonSchema");
		expect(source).toContain("unchecked");
	});
});

describe("pets (Swagger 2.0)", () => {
	it("writes array query parameters in the styles Swagger describes", async () => {
		const fetch = mockFetch(json([]));
		await createPets({ fetch }).pets.listPets({ query: { tags: ["a", "b"], sort: ["x", "y"], ids: [1, 2] } });
		expect(new URL(fetch.calls[0]!.url).search).toBe("?tags=a%2Cb&sort=x%7Cy&ids=1&ids=2");
	});

	it("sends urlencoded forms and reads XML", async () => {
		const fetch = mockFetch(json({ token: "t" }));
		const api = createPets({ fetch });
		const login = await api.login({ body: { user: "u", password: "p w" } });
		expect(login).toEqual({ token: "t" });
		expect(fetch.calls[0]!.body).toBeInstanceOf(URLSearchParams);
		expect(await readBody(fetch.calls[0]!.body)).toBe("user=u&password=p+w");

		const xml = "<pet><id>1</id><name>Rex</name></pet>";
		const xmlFetch = mockFetch(new Response(xml, { headers: { "content-type": "application/xml" } }));
		const pet = await createPets({ fetch: xmlFetch }).exportXml();
		expect(pet).toMatchObject({ name: "Rex" });
	});
});

describe("generate() options and edge cases", () => {
	const base = {
		openapi: "3.0.3",
		info: { title: "T", version: "1" },
		paths: {} as Record<string, unknown>,
	};
	const ok = { 200: { description: "ok", content: { "application/json": { schema: { type: "string" } } } } };

	it("names operations without an operationId from the method and path", () => {
		const { code } = generate({ ...base, paths: { "/pets/{petId}/photos": { get: { responses: ok } } } });
		expect(code).toContain("getPetsByPetIdPhotos: endpoint.get(");
	});

	it("keeps duplicate names apart", () => {
		const op = { operationId: "list", responses: ok };
		const { code } = generate({ ...base, paths: { "/a": { get: op }, "/b": { get: op } } });
		expect(code).toContain('list: endpoint.get("/a")');
		expect(code).toContain('list2: endpoint.get("/b")');
	});

	it("groups by the first tag, or not at all", () => {
		const doc = {
			...base,
			paths: {
				"/a": { get: { tags: ["Users Admin"], operationId: "x", responses: ok } },
				"/b": { get: { operationId: "y", responses: ok } },
			},
		};
		const grouped = generate(doc).code;
		expect(grouped).toMatch(/usersAdmin: \{\n\t\t\/\*\*[^]*?\n\t\tx: endpoint/);
		expect(grouped).toContain("\ty: endpoint.get");
		expect(generate(doc, { group: "none" }).code).not.toContain("usersAdmin");
	});

	it("imports the library from the given module", () => {
		const { code } = generate({ ...base, paths: { "/a": { get: { responses: ok } } } }, { importFrom: "../src" });
		expect(code).toContain('from "../src";');
		expect(code).toContain('from "../src/openapi";');
	});

	it("skips operations it cannot express and says so", () => {
		const { code, warnings } = generate({
			...base,
			paths: {
				"/a/{user-id}": {
					get: {
						parameters: [{ name: "user-id", in: "path", required: true, schema: { type: "string" } }],
						responses: ok,
					},
				},
				"/b": {
					get: {
						operationId: "kept",
						parameters: [{ name: "sid", in: "cookie", schema: { type: "string" } }],
						responses: ok,
					},
				},
			},
		});
		expect(code).not.toContain("/a/");
		expect(code).toContain("kept");
		expect(warnings.join("\n")).toContain('"user-id" is not a valid name');
		expect(warnings.join("\n")).toContain("cookie parameters are not supported");
	});

	it("rejects documents without operations", () => {
		expect(() => generate(base)).toThrow("no operations");
	});

	it("does not let a schema called like a helper break the file", () => {
		const doc = {
			...base,
			paths: {
				"/a": {
					get: {
						operationId: "x",
						responses: {
							200: {
								description: "ok",
								content: { "application/json": { schema: { $ref: "#/components/schemas/endpoint" } } },
							},
						},
					},
				},
			},
			components: {
				schemas: { endpoint: { type: "object", properties: { id: { type: "integer" } } }, Blob: { type: "string" } },
			},
		};
		const { code } = generate(doc);
		expect(code).toContain("export interface endpoint2");
		expect(code).toContain("export type Blob_ = string;");
		expect(typecheck({ "api.ts": code }, { paths: LIBRARY })).toEqual([]);
	});

	it("types several successful responses as a union and ranges as untyped", () => {
		const { code, warnings } = generate({
			...base,
			paths: {
				"/a": {
					put: {
						operationId: "up",
						responses: {
							200: { description: "x", content: { "application/json": { schema: { type: "string" } } } },
							201: { description: "y", content: { "application/json": { schema: { type: "integer" } } } },
							"4XX": { description: "z", content: { "application/json": { schema: { type: "string" } } } },
						},
					},
				},
			},
		});
		expect(code).toContain(".returns(jsonSchema<string | number>(");
		expect(warnings.join("\n")).toContain("4XX response is not typed");
	});

	it("treats a body without content as void and an optional body as optional", () => {
		const { code } = generate({
			...base,
			paths: {
				"/a": {
					post: {
						operationId: "make",
						requestBody: { required: false, content: { "application/json": { schema: { type: "object" } } } },
						responses: { 204: { description: "none" } },
					},
				},
			},
		});
		expect(code).toContain(".body(optional(jsonSchema<Record<string, unknown>>(");
		expect(code).toContain(".as<void>()");
	});
});
