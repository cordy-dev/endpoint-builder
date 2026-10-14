import { describe, expect, it } from "vitest";

import { createClient, schema, validate } from "../src";
import { optional, queryStyle } from "../src/openapi";
import { json, mockFetch } from "./helpers";

const Query = schema((value) => value as { tags: string[]; ids?: number[]; q?: string });

describe("optional", () => {
	it("passes undefined through and validates everything else", async () => {
		const maybe = optional(schema((v) => (typeof v === "string" ? v : Promise.reject(new Error("no")))));
		expect(await validate(maybe, undefined)).toEqual({ success: true, value: undefined });
		expect(await validate(maybe, "a")).toEqual({ success: true, value: "a" });
		expect((await validate(maybe, 1)).success).toBe(false);
	});
});

describe("queryStyle", () => {
	it("joins the chosen arrays and leaves the rest alone", async () => {
		const outcome = await validate(queryStyle(Query, { tags: "pipe", ids: "comma" }), {
			tags: ["a", "b"],
			ids: [1, 2],
			q: "x",
		});
		expect(outcome).toEqual({ success: true, value: { tags: "a|b", ids: "1,2", q: "x" } });
		expect(await validate(queryStyle(Query, { tags: "space" }), { tags: ["a", "b"] })).toMatchObject({
			value: { tags: "a b" },
		});
	});

	it("reaches the URL, encoded", async () => {
		const fetch = mockFetch(json({}));
		const api = createClient({ baseUrl: "https://api.test", fetch });
		await api
			.get("/pets", { query: { tags: ["a", "b"] } })
			.query({ tags: ["a", "b"] }, queryStyle(Query, { tags: "pipe" }));
		expect(fetch.mock.calls[0]![0]).toBe("https://api.test/pets?tags=a%7Cb");
	});
});
