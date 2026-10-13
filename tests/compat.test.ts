import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createClient, defineContract, endpoint, type InferInput, type InferOutput, ValidationError } from "../src";
import { mockClient } from "../src/testing";
import { json, mockFetch } from "./helpers";

/** The same contract written with each Standard Schema library must behave and infer the same */
const libraries = {
	zod: {
		User: z.object({ id: z.number(), name: z.string() }),
		Create: z.object({ name: z.string().min(1) }),
		Query: z.object({ page: z.number().optional() }),
		Problem: z.object({ message: z.string() }),
	},
	valibot: {
		User: v.object({ id: v.number(), name: v.string() }),
		Create: v.object({ name: v.pipe(v.string(), v.minLength(1)) }),
		Query: v.object({ page: v.optional(v.number()) }),
		Problem: v.object({ message: v.string() }),
	},
	arktype: {
		User: type({ id: "number", name: "string" }),
		Create: type({ name: "string > 0" }),
		Query: type({ "page?": "number" }),
		Problem: type({ message: "string" }),
	},
};

describe.each(Object.entries(libraries))("%s", (_name, s) => {
	const contract = defineContract({
		get: endpoint.get("/users/:id").returns(s.User as typeof libraries.zod.User).errors({ 404: s.Problem as typeof libraries.zod.Problem }),
		list: endpoint.get("/users").query(s.Query as typeof libraries.zod.Query).returns(z.array(z.object({ id: z.number(), name: z.string() }))),
		create: endpoint.post("/users").body(s.Create as typeof libraries.zod.Create).returns(s.User as typeof libraries.zod.User),
	});

	it("validates responses, bodies, queries and error bodies", async () => {
		const api = mockClient(contract, {
			get: ({ params }, { fail }) => params.id === "0" ? fail(404, { message: "no user" }) : { id: Number(params.id), name: "Ann" },
			list: ({ query }) => [{ id: Number(query.page ?? 0), name: "a" }],
			create: ({ body }) => ({ id: 1, name: body.name }),
		});

		expect(await api.get({ params: { id: 3 } })).toEqual({ id: 3, name: "Ann" });
		expect(await api.list({ query: { page: 2 } })).toEqual([{ id: 2, name: "a" }]);
		expect(await api.create({ body: { name: "Bo" } })).toEqual({ id: 1, name: "Bo" });

		const notFound = await api.get({ params: { id: 0 } }).safe();
		expect(notFound.error?.type === "http" && notFound.error.body).toEqual({ message: "no user" });

		const bad = await api.create({ body: { name: "" } }).safe();
		expect(bad.error).toBeInstanceOf(ValidationError);
		expect((bad.error as ValidationError).stage).toBe("body");
		expect((bad.error as ValidationError).issues.length).toBeGreaterThan(0);
	});

	it("rejects wrong response shapes with located issues", async () => {
		const api = createClient({ baseUrl: "https://api.test", fetch: mockFetch(json({ id: "1", name: "a" })) });
		const { error } = await api.get("/users/1").returns(s.User).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect(Array.from((error as ValidationError).issues[0]!.path ?? [], p => typeof p === "object" ? p.key : p)).toEqual(["id"]);
		expect((error as ValidationError).message).toMatch(/^Invalid response at "id"/);
	});
});

describe("type inference is identical across libraries", () => {
	it("infers input and output types", () => {
		expectTypeOf<InferOutput<typeof libraries.arktype.User>>().toEqualTypeOf<{ id: number; name: string }>();
		expectTypeOf<InferOutput<typeof libraries.valibot.User>>().toEqualTypeOf<{ id: number; name: string }>();
		expectTypeOf<InferOutput<typeof libraries.zod.User>>().toEqualTypeOf<{ id: number; name: string }>();
		expectTypeOf<InferInput<typeof libraries.arktype.Create>>().toEqualTypeOf<{ name: string }>();
		expectTypeOf<InferInput<typeof libraries.valibot.Create>>().toEqualTypeOf<{ name: string }>();
	});
});
