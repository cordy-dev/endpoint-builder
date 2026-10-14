import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { createApi, defineContract, endpoint, type EndpointInput, ValidationError } from "../src";
import { json, mockFetch } from "./helpers";

const Tenant = z.object({ "x-tenant": z.string(), "x-trace": z.string().optional() });
const Paging = z.object({ "x-page-size": z.coerce.number().default(20) });

const contract = defineContract({
	me: endpoint.get("/me").headers(Tenant).as<{ id: number }>(),
	list: endpoint.get("/list").headers(Paging).defaultHeaders({ "x-client": "web" }),
	plain: endpoint.get("/plain"),
});

describe("typed endpoint headers", () => {
	it("makes required headers required in the input type", () => {
		type MeInput = EndpointInput<typeof contract.me>;
		expectTypeOf<MeInput["headers"]>().toEqualTypeOf<{ "x-tenant": string; "x-trace"?: string | undefined }>();

		const api = createApi(contract);
		const compileOnly = () => {
			// @ts-expect-error headers are required
			void api.me();
			// @ts-expect-error x-tenant is required
			void api.me({ headers: {} });
			// @ts-expect-error x-tenant must be a string
			void api.me({ headers: { "x-tenant": 1 } });
			void api.me({ headers: { "x-tenant": "acme" } });
		};
		void compileOnly;
	});

	it("keeps headers optional when every field is optional or has a default", () => {
		type ListInput = EndpointInput<typeof contract.list>;
		expectTypeOf<ListInput["headers"]>().toEqualTypeOf<{ "x-page-size"?: unknown } | undefined>();
		const api = createApi(contract);
		const compileOnly = () => { void api.list(); void api.list({ headers: { "x-page-size": 50 } }); };
		void compileOnly;
	});

	it("untyped endpoints still accept any headers", () => {
		type PlainInput = EndpointInput<typeof contract.plain>;
		expectTypeOf<PlainInput["headers"]>().not.toBeAny();
		const api = createApi(contract);
		const compileOnly = () => { void api.plain({ headers: { "x-anything": "1" } }); };
		void compileOnly;
	});

	it("validates, transforms and sends the headers", async () => {
		const fetch = mockFetch(json({ id: 1 }));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch, headers: { "x-app": "web" } });

		await api.me({ headers: { "x-tenant": "acme", "x-trace": "t1" } });
		expect(fetch.calls[0]!.headers.get("x-tenant")).toBe("acme");
		expect(fetch.calls[0]!.headers.get("x-trace")).toBe("t1");
		expect(fetch.calls[0]!.headers.get("x-app")).toBe("web");

		await api.list(); // the schema default is applied and defaultHeaders are kept
		await api.list({ headers: { "x-page-size": "50" } });
		expect(fetch.calls[1]!.headers.get("x-page-size")).toBe("20");
		expect(fetch.calls[1]!.headers.get("x-client")).toBe("web");
		expect(fetch.calls[2]!.headers.get("x-page-size")).toBe("50");
	});

	it("rejects invalid headers before sending", async () => {
		const fetch = mockFetch(json({}));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		// @ts-expect-error missing x-tenant on purpose
		const { error } = await api.me({ headers: {} }).safe();
		expect(error).toBeInstanceOf(ValidationError);
		expect((error as ValidationError).stage).toBe("headers");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("untyped endpoints send the headers as given", async () => {
		const fetch = mockFetch(json({}));
		const api = createApi(contract, { baseUrl: "https://api.test", fetch });
		await api.plain({ headers: { "x-anything": "1" } });
		expect(fetch.calls[0]!.headers.get("x-anything")).toBe("1");
	});
});
