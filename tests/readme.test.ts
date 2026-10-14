/**
 * Keeps the README examples honest: they must type-check and behave as documented.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { Client, createApi, defineContract, endpoint, isHttpError, type Middleware, refreshable } from "../src";
import { json, mockFetch } from "./helpers";

const User = z.object({ id: z.number(), name: z.string() });
const NotFound = z.object({ message: z.string() });
const Unauthorized = z.object({ reason: z.string() });
const CreateUser = z.object({ name: z.string(), email: z.email() });
const Problem = z.object({ title: z.string() });
const ListQuery = z.object({ page: z.number().optional() });

const contract = defineContract({
	users: {
		list: endpoint.get("/users").query(ListQuery).returns(z.array(User)),
		get: endpoint.get("/users/:id").returns(User).errors({ 404: NotFound }),
		create: endpoint.post("/users").body(CreateUser).returns(User).errors({ 422: Problem }),
		remove: endpoint.delete("/users/:id"),
	},
	health: endpoint.get("/health").as<{ status: "ok" }>(),
});

describe("README", () => {
	it("safe() narrowing example", async () => {
		const fetch = mockFetch(json({ message: "gone" }, { status: 404 }));
		const api = createApi(contract, { baseUrl: "https://api.test", errors: { 401: Unauthorized }, fetch });

		const { data, error } = await api.users.get({ params: { id: 1 } }).safe();
		let seen = "";
		if (isHttpError(error, 404)) {
			expectTypeOf(error.body).toEqualTypeOf<{ message: string }>();
			seen = error.body.message;
		} else if (error?.type === "validation") {
			expectTypeOf(error.stage).toEqualTypeOf<"params" | "query" | "headers" | "body" | "response" | "error">();
		} else if (error) {
			throw error;
		} else {
			expectTypeOf(data).toEqualTypeOf<{ id: number; name: string }>();
		}
		expect(seen).toBe("gone");
	});

	it("builder + middleware example", async () => {
		const fetch = mockFetch(json({ id: 1, name: "a" }));
		const seen: unknown[] = [];
		const timing: Middleware = async (ctx, next) => {
			try {
				return await next(ctx);
			} finally {
				seen.push(ctx.meta.feature);
			}
		};
		let token = "a";
		const api = Client.builder("https://api.test")
			.header("X-App", "web")
			.timeout(10_000)
			.auth(
				refreshable({
					getToken: () => token,
					refresh: () => {
						token = "b";
					},
				}),
			)
			.retry({ limit: 3 })
			.use(timing)
			.fetch(fetch)
			.build();

		const listUsers = api.get("/users/:id", { params: { id: 1 } }).returns(User);
		expect(await listUsers.meta("feature", "search")).toEqual({ id: 1, name: "a" });
		expect(seen).toEqual(["search"]);
	});

	it("contract example", async () => {
		const fetch = mockFetch(json({ id: 1, name: "Ann" }), json([]), json({ id: 1, name: "Ann" }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch, auth: "token" });
		const user = await api.users.create({ body: { name: "Ann", email: "a@b.co" } });
		expectTypeOf(user).toEqualTypeOf<{ id: number; name: string }>();
		await api.users.list();
		await api.users
			.get({ params: { id: 1 } })
			.timeout(1000)
			.safe();
		expect(fetch.calls[0]!.headers.get("authorization")).toBe("Bearer token");
	});
});
