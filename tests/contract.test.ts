import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { type ApiError, createClient, defineContract, type Endpoint, endpoint, type EndpointInput, HttpError, isHttpError, ValidationError } from "../src";
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
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);

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

		const api = createClient().api(contract);
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
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);

		const bad = await api.users.create({ body: { name: "", email: "nope" } }).safe();
		expect(bad.error).toBeInstanceOf(ValidationError);
		expect((bad.error as ValidationError).stage).toBe("body");
		expect(fetch).not.toHaveBeenCalled();

		await api.users.create({ body: { name: "a", email: "a@b.co" } });
		expect(await readBody(fetch.calls[0]!.body)).toBe("{\"name\":\"a\",\"email\":\"a@b.co\"}");
	});

	it("validates query with valibot and params with zod", async () => {
		const fetch = mockFetch(json([]));
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);
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
		const api = createClient({ baseUrl: "https://api.test", fetch, retry: false, errors: { 401: Unauthorized } }).api(contract);

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
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).stage).toBe("error");
	});

	it("bound calls are still request builders", async () => {
		const fetch = mockFetch(json({ status: "ok" }));
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);
		const response = await api.health().header("x-trace", "1").timeout(1000).send();
		expectTypeOf(response.data).toEqualTypeOf<{ status: "ok" }>();
		expect(fetch.calls[0]!.headers.get("x-trace")).toBe("1");
	});

	it("undeclared statuses still produce HttpError", async () => {
		const fetch = mockFetch(json({}, { status: 409 }));
		const api = createClient({ baseUrl: "https://api.test", fetch }).api(contract);
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
