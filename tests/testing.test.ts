import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import { bearer, createApi, defineContract, endpoint, HttpError, isHttpError, ValidationError } from "../src";
import { mockClient, mockFetch } from "../src/testing";

const User = z.object({ id: z.number(), name: z.string() });
const NotFound = z.object({ message: z.string() });
const CreateUser = z.object({ name: z.string().min(1) });
const Event = z.object({ n: z.number() });

const contract = defineContract({
	users: {
		list: endpoint.get("/users").query(z.object({ tag: z.array(z.string()).optional(), page: z.number().optional() })).returns(z.array(User)),
		get: endpoint.get("/users/:id").returns(User).errors({ 404: NotFound }),
		create: endpoint.post("/users").body(CreateUser).returns(User),
		remove: endpoint.delete("/users/:id"),
		avatar: endpoint.get("/users/:id/avatar.png").as<unknown>(),
		search: endpoint.get("/users/search").returns(z.array(User)),
	},
	files: { get: endpoint.get("/files/:name?").as<{ name: string }>() },
	events: endpoint.get("/events").sse(Event),
	log: endpoint.get("/log").sse(),
	export: endpoint.get("/export").ndjson(Event),
});

describe("mockClient", () => {
	it("answers endpoints with typed handlers", async () => {
		const api = mockClient(contract, {
			users: {
				get: ({ params }) => {
					expectTypeOf(params).toEqualTypeOf<{ id: string }>();
					return { id: Number(params.id), name: "Ann" };
				},
			},
		});
		const user = await api.users.get({ params: { id: 7 } });
		expectTypeOf(user).toEqualTypeOf<{ id: number; name: string }>();
		expect(user).toEqual({ id: 7, name: "Ann" });
	});

	it("types handler return values against the endpoint", () => {
		mockClient(contract, {
			users: {
				// @ts-expect-error the handler must return a User
				get: () => ({ id: "7" }),
				create: ({ body }) => {
					expectTypeOf(body).toEqualTypeOf<{ name: string }>();
					return { id: 1, name: body.name };
				},
			},
		});
	});

	it("fail() is typed from the declared errors and reaches the client as a typed HttpError", async () => {
		const api = mockClient(contract, {
			users: {
				get: (_input, { fail }) => fail(404, { message: "no user" }),
			},
		});
		mockClient(contract, {
			users: {
				// @ts-expect-error 404 bodies must match NotFound
				get: (_input, { fail }) => fail(404, { nope: true }),
			},
		});
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expect(isHttpError(error, 404)).toBe(true);
		if (isHttpError(error, 404)) {
			expectTypeOf(error.body).toEqualTypeOf<{ message: string }>();
			expect(error.body.message).toBe("no user");
		}
		// undeclared statuses are fine with any body
		const loose = mockClient(contract, { users: { remove: (_input, { fail }) => fail(409, "conflict") } });
		const result = await loose.users.remove({ params: { id: 1 } }).safe();
		expect((result.error as HttpError).status).toBe(409);
	});

	it("still validates requests and responses with the real schemas", async () => {
		const create = vi.fn(() => ({ id: 1, name: "x" }));
		const get = vi.fn(() => ({ id: "nope" }) as never);
		const api = mockClient(contract, { users: { create, get } });

		const bad = await api.users.create({ body: { name: "" } }).safe();
		expect((bad.error as ValidationError).stage).toBe("body");
		expect(create).not.toHaveBeenCalled();

		const wrong = await api.users.get({ params: { id: 1 } }).safe();
		expect((wrong.error as ValidationError).stage).toBe("response");

		const brokenError = mockClient(contract, { users: { get: (_input, { fail }) => fail(404, { unexpected: true } as never) } });
		const { error } = await brokenError.users.get({ params: { id: 1 } }).safe();
		expect((error as ValidationError).stage).toBe("error");
	});

	it("passes decoded params, repeated query values and the parsed body", async () => {
		const seen: unknown[] = [];
		const api = mockClient(contract, {
			users: {
				get: ({ params }) => { seen.push(params); return { id: 1, name: "a" }; },
				list: ({ query }) => { seen.push(query); return []; },
				create: ({ body, headers }) => { seen.push([body, headers.get("content-type")]); return { id: 2, name: body.name }; },
			},
		});
		await api.users.get({ params: { id: "a b/c" } });
		await api.users.list({ query: { tag: ["x", "y"], page: 2 } });
		await api.users.create({ body: { name: "Bo" } });
		expect(seen).toEqual([{ id: "a b/c" }, { tag: ["x", "y"], page: "2" }, [{ name: "Bo" }, "application/json"]]);
	});

	it("routes static paths before parameterized ones, handles optional params and file suffixes", async () => {
		const api = mockClient(contract, {
			users: {
				get: ({ params }) => ({ id: Number(params.id), name: "by-id" }),
				search: () => [{ id: 0, name: "search" }],
				avatar: ({ params }) => `avatar-${params.id}`,
			},
			files: { get: ({ params }) => ({ name: params.name ?? "index" }) },
		});
		expect(await api.users.search()).toEqual([{ id: 0, name: "search" }]);
		expect(await api.users.get({ params: { id: 5 } })).toEqual({ id: 5, name: "by-id" });
		expect(await api.users.avatar({ params: { id: 5 } }).text()).toBe("\"avatar-5\"");
		expect(await api.files.get()).toEqual({ name: "index" });
		expect(await api.files.get({ params: { name: "a.txt" } })).toEqual({ name: "a.txt" });
	});

	it("answers 501 for endpoints without a handler, and 204 for undefined", async () => {
		const api = mockClient(contract, { users: { remove: () => undefined as never } });
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expect((error as HttpError).status).toBe(501);
		expect((error as HttpError).body).toBe("[mock] no handler for GET /users/1");
		const removed = await api.users.remove({ params: { id: 1 } }).send();
		expect(removed.status).toBe(204);
	});

	it("mocks SSE and NDJSON streams with plain iterables", async () => {
		async function* generate() { yield { n: 1 }; yield { n: 2 }; }
		const api = mockClient(contract, {
			events: () => generate(),
			export: () => [{ n: 1 }, { n: 2 }, { n: 3 }],
			log: () => [{ event: "tick", data: "a\nb", id: "1" }, "plain"],
		});
		expect(await (await api.events()).toArray()).toEqual([{ n: 1 }, { n: 2 }]);
		expect(await (await api.export()).toArray()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
		expect(await (await api.log()).toArray()).toMatchObject([{ event: "tick", data: "a\nb", id: "1" }, { event: "message", data: "plain" }]);
	});

	it("honours client options: baseUrl with a path prefix, auth, default errors", async () => {
		const seen: (string | null)[] = [];
		const api = mockClient(contract, {
			users: { get: ({ headers }) => { seen.push(headers.get("authorization")); return { id: 1, name: "a" }; } },
		}, { baseUrl: "https://api.test/v2", auth: bearer("t"), errors: { 401: z.object({ reason: z.string() }) } });
		expect(await api.users.get({ params: { id: 1 } })).toEqual({ id: 1, name: "a" });
		expect(seen).toEqual(["Bearer t"]);
	});

	it("handler exceptions surface as NetworkError with the cause", async () => {
		const api = mockClient(contract, { users: { get: () => { throw new RangeError("handler bug"); } } });
		const { error } = await api.users.get({ params: { id: 1 } }).safe();
		expect(error?.type).toBe("network");
		expect((error as { cause?: unknown }).cause).toBeInstanceOf(RangeError);
	});
});

describe("testing retries (README example)", () => {
	const payments = defineContract({
		create: endpoint.post("/payments").body(z.object({ title: z.string() })).returns(User).idempotent(),
	});

	it("fail(503) simulates a transient failure; the retry carries the same Idempotency-Key", async () => {
		const keys: (string | null)[] = [];
		let calls = 0;
		const fetch = mockFetch(payments, {
			create: ({ headers }, { fail }) => {
				keys.push(headers.get("idempotency-key"));
				return ++calls === 1 ? fail(503) : { id: 1, name: "x" };
			},
		});
		const api = createApi(payments, { baseUrl: "http://mock.test", fetch, retry: { delay: 0 } });
		expect(await api.create({ body: { title: "x" } })).toEqual({ id: 1, name: "x" });
		expect(calls).toBe(2);
		expect(keys[0]).toBeTruthy();
		expect(keys[0]).toBe(keys[1]);
	});

	it("static paths win over parameterized ones in mockFetch too, and headers is a native Headers", async () => {
		const routes = defineContract({
			one: endpoint.get("/todos/:id").as<string>(),
			stream: endpoint.get("/todos/stream").as<string>(),
		});
		const fetch = mockFetch(routes, {
			one: ({ params, headers }) => { expectTypeOf(headers).toEqualTypeOf<Headers>(); return `one:${params.id}`; },
			stream: () => "stream",
		});
		const api = createApi(routes, { baseUrl: "http://mock.test", fetch });
		expect(await api.stream()).toBe("stream");
		expect(await api.one({ params: { id: 7 } })).toBe("one:7");
	});
});

describe("mockFetch", () => {
	it("lets you test a fully configured client", async () => {
		const fetch = mockFetch(contract, { users: { get: ({ headers }) => ({ id: 1, name: headers.get("x-app") ?? "" }) } }, { baseUrl: "https://api.test" });
		const api = createApi(contract, { baseUrl: "https://api.test", fetch, headers: { "x-app": "web" } });
		expect(await api.users.get({ params: { id: 1 } })).toEqual({ id: 1, name: "web" });
	});
});
