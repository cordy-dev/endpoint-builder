import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { type ApiError, type Client, createApi, defineContract, type Endpoint, endpoint, type EndpointInput, HttpError, isHttpError, ValidationError } from "../src";
import { json, mockFetch, readBody } from "./helpers";

const User = z.object({ id: z.number(), name: z.string() });
const CreateUser = z.object({ name: z.string().min(1), email: z.email() });
const ListQuery = v.object({ page: v.optional(v.number()), search: v.optional(v.string()) });
const NotFound = z.object({ message: z.string() });
const Unauthorized = z.object({ reason: z.string() });

const contract = defineContract({
	users: {
		list: endpoint.get("/users").query(ListQuery).returns(z.array(User)),
		get: endpoint.get("/users/:id").returns(User).errors({ 404: NotFound }),
		create: endpoint.post("/users").body(CreateUser).returns(User),
		remove: endpoint.delete("/users/:id"),
	},
	health: endpoint.get("/health").as<{ status: "ok" }>(),
	byUuid: endpoint.get("/items/:id").params(z.object({ id: z.uuid() })),
});

describe("contracts", () => {
	it("binds nested endpoints with full inference", async () => {
		const fetch = mockFetch(json({ id: 1, name: "a" }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });

		const user = await api.users.get({ params: { id: 1 } });
		expectTypeOf(user).toEqualTypeOf<{ id: number; name: string }>();
		expect(user).toEqual({ id: 1, name: "a" });
		expect(fetch.calls[0]!.url).toBe("https://api.test/users/1");
	});

	it("derives input types from schemas", () => {
		type ListInput = EndpointInput<typeof contract.users.list>;
		expectTypeOf<ListInput["query"]>().toEqualTypeOf<{ page?: number | undefined; search?: string | undefined } | undefined>();

		type CreateInput = EndpointInput<typeof contract.users.create>;
		expectTypeOf<CreateInput["body"]>().toEqualTypeOf<{ name: string; email: string }>();

		type GetInput = EndpointInput<typeof contract.users.get>;
		expectTypeOf<GetInput["params"]>().toEqualTypeOf<{ id: string | number | bigint | boolean }>();

		const api = createApi(contract);
		const call = () => {
			// @ts-expect-error params are required
			void api.users.get();
			// @ts-expect-error wrong body shape
			void api.users.create({ body: { name: 1 } });
			// optional input when nothing is required
			void api.health();
			void api.users.list();
		};
		void call;
	});

	it("validates bodies before sending", async () => {
		const fetch = mockFetch(json({ id: 1, name: "a" }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });

		const bad = await api.users.create({ body: { name: "", email: "nope" } }).safe();
		expect(bad.error).toBeInstanceOf(ValidationError);
		expect((bad.error as ValidationError).stage).toBe("body");
		expect(fetch).not.toHaveBeenCalled();

		await api.users.create({ body: { name: "a", email: "a@b.co" } });
		expect(await readBody(fetch.calls[0]!.body)).toBe("{\"name\":\"a\",\"email\":\"a@b.co\"}");
	});

	it("validates query with valibot and params with zod", async () => {
		const fetch = mockFetch(json([]));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		await api.users.list({ query: { page: 2 } });
		expect(fetch.calls[0]!.url).toBe("https://api.test/users?page=2");

		// @ts-expect-error page must be a number
		const badQuery = await api.users.list({ query: { page: "2" } }).safe();
		expect((badQuery.error as ValidationError).stage).toBe("query");

		const badParams = await api.byUuid({ params: { id: "not-a-uuid" } }).safe();
		expect((badParams.error as ValidationError).stage).toBe("params");
	});

	it("types declared errors per status (client + endpoint)", async () => {
		const fetch = mockFetch(json({ message: "no user" }, { status: 404 }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch, retry: false, errors: { 401: Unauthorized } });

		const { error } = await api.users.get({ params: { id: 7 } }).safe();
		expectTypeOf(error).toEqualTypeOf<ApiError<{ 401: { reason: string }; 404: { message: string } }> | undefined>();

		const inspect = (e: typeof error) => {
			if (isHttpError(e, 404)) {
				expectTypeOf(e.body).toEqualTypeOf<{ message: string }>();
				return e.body.message;
			} else if (isHttpError(e, 401)) {
				expectTypeOf(e.body).toEqualTypeOf<{ reason: string }>();
			} else if (isHttpError(e, 500)) {
				expectTypeOf(e.body).toEqualTypeOf<unknown>();
			} else if (e?.type === "validation") {
				expectTypeOf(e).toEqualTypeOf<ValidationError>();
			}
		};
		expect(inspect(error)).toBe("no user");
	});

	it("rejects error bodies that break the declared contract", async () => {
		const fetch = mockFetch(json({ unexpected: true }, { status: 404 }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).stage).toBe("error");
	});

	it("bound calls are still request builders", async () => {
		const fetch = mockFetch(json({ status: "ok" }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		const response = await api.health().header("x-trace", "1").timeout(1000).send();
		expectTypeOf(response.data).toEqualTypeOf<{ status: "ok" }>();
		expect(fetch.calls[0]!.headers.get("x-trace")).toBe("1");
	});

	it("undeclared statuses still produce HttpError", async () => {
		const fetch = mockFetch(json({}, { status: 409 }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		await expect(api.users.remove({ params: { id: 1 } })).rejects.toBeInstanceOf(HttpError);
	});
});

describe("Endpoint spec generic", () => {
	it("exposes one readable spec instead of positional generics", () => {
		type Spec = (typeof contract.users.get)["~spec"];
		expectTypeOf<Spec["method"]>().toEqualTypeOf<"GET">();
		expectTypeOf<Spec["path"]>().toEqualTypeOf<"/users/:id">();
		expectTypeOf<Spec["data"]>().toEqualTypeOf<{ id: number; name: string }>();
		expectTypeOf<Spec["errors"]>().toEqualTypeOf<{ 404: { message: string } }>();
	});

	it("accepts any endpoint through Endpoint<any>", () => {
		const name = <E extends Endpoint<any>>(e: E) => e.definition.path;
		expect(name(contract.users.get)).toBe("/users/:id");
		expect(name(contract.users.create)).toBe("/users");
	});
});

describe("createApi", () => {
	const fetch = () => mockFetch(json({ id: 1, name: "a" }));

	it("binds a contract in one step", async () => {
		const f = fetch();
		const api = createApi(contract, { baseUrl: "https://api.test", fetch: f, auth: "t" });
		expect(await api.users.get({ params: { id: 1 } })).toEqual({ id: 1, name: "a" });
		expect(f.calls[0]!.headers.get("authorization")).toBe("Bearer t");
		expect(createApi(contract)).toBeDefined(); // options are optional
	});

	it("$client is the plain client, $with derives a new API for the same contract", async () => {
		const f = fetch();
		const api = createApi(contract, { baseUrl: "https://api.test", fetch: f, headers: { "x-app": "web" } });
		await api.$client.get("/health");
		const admin = api.$with({ headers: { "x-role": "admin" } });
		await admin.users.get({ params: { id: 1 } });
		await api.users.get({ params: { id: 1 } });
		expect(f.calls[0]!.url).toBe("https://api.test/health");
		expect(f.calls[1]!.headers.get("x-role")).toBe("admin");
		expect(f.calls[1]!.headers.get("x-app")).toBe("web");
		expect(f.calls[2]!.headers.has("x-role")).toBe(false); // the parent is untouched
		expect(admin.$client).not.toBe(api.$client);
	});

	it("keeps $client and $with out of enumeration", () => {
		const api = createApi(contract);
		expect(Object.keys(api)).toEqual(Object.keys(contract));
	});

	it("accumulates declared errors in the type, also through $with", async () => {
		const Unauthorized = z.object({ reason: z.string() });
		const api = createApi(contract, { baseUrl: "https://api.test", fetch: mockFetch(json({ reason: "no" }, { status: 401 })), retry: false, errors: { 401: Unauthorized } });
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expectTypeOf(error).toEqualTypeOf<ApiError<{ 401: { reason: string }; 404: { message: string } }> | undefined>();
		expect(isHttpError(error, 401)).toBe(true);

		const plain = createApi(contract).$with({ errors: { 401: Unauthorized } });
		expectTypeOf(plain.$client).toEqualTypeOf<Client<{ 401: { reason: string } }>>();
	});

	it("rejects contract keys that would clash with its own members", () => {
		const clash = defineContract({ $client: endpoint.get("/x") });
		expect(() => createApi(clash)).toThrow("\"$client\" is reserved");
	});
});
