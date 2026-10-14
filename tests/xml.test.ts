import { describe, expect, it } from "vitest";

import { validate } from "../src";
import { type JsonSchema, type JsonSchemaDefs, jsonSchema } from "../src/openapi/json-schema";
import { xmlBody, xmlResponse } from "../src/openapi/xml";

const defs: JsonSchemaDefs = {
	Category: {
		type: "object",
		properties: { id: { type: "integer" }, name: { type: "string" } },
		xml: { name: "category" },
	},
	Pet: {
		type: "object",
		required: ["name"],
		xml: { name: "pet" },
		properties: {
			id: { type: "integer", xml: { attribute: true } },
			name: { type: "string" },
			category: { $ref: "#/$defs/Category" },
			tags: { type: "array", xml: { wrapped: true }, items: { type: "string", xml: { name: "tag" } } },
			photos: { type: "array", items: { type: "string", xml: { name: "photo" } } },
			available: { type: "boolean" },
		},
	},
};
const pet: JsonSchema = { $ref: "#/$defs/Pet" };

const read = (xml: unknown) => validate(xmlResponse(pet, defs), xml);
const write = (value: unknown, root?: string) => validate(xmlBody(pet, defs, root ? { root } : undefined), value);

describe("binary strings", () => {
	const binary = jsonSchema({ type: "string", format: "binary" });
	it("accepts files, buffers, streams and text but not numbers", async () => {
		for (const value of ["x", new Blob(["x"]), new ArrayBuffer(1), new Uint8Array(1), new ReadableStream()]) {
			expect(await validate(binary, value)).toEqual({ success: true, value });
		}
		const bad = await validate(binary, 5);
		expect(bad.success).toBe(false);
	});
});

describe("xmlResponse", () => {
	it("reads attributes, nested elements, wrapped and unwrapped arrays", async () => {
		const outcome = await read(`<?xml version="1.0"?>
			<pet id="7">
				<name>Rex</name>
				<category><id>2</id><name>Dogs</name></category>
				<tags><tag>a</tag><tag>b</tag></tags>
				<photo>p1</photo><photo>p2</photo>
				<available>true</available>
				<ignored>x</ignored>
			</pet>`);
		expect(outcome).toEqual({
			success: true,
			value: {
				id: 7,
				name: "Rex",
				category: { id: 2, name: "Dogs" },
				tags: ["a", "b"],
				photos: ["p1", "p2"],
				available: true,
			},
		});
	});

	it("decodes predefined entities, character references and CDATA", async () => {
		const outcome = await read(`<pet><name>A &amp; B &lt;&#65;&#x42;&gt;<![CDATA[ <raw> ]]></name></pet>`);
		expect(outcome).toMatchObject({ success: true, value: { name: "A & B <AB> <raw> " } });
	});

	it("ignores namespace prefixes and comments", async () => {
		const outcome = await read(`<p:pet xmlns:p="urn:x"><!-- hi --><p:name>Rex</p:name></p:pet>`);
		expect(outcome).toMatchObject({ success: true, value: { name: "Rex" } });
	});

	it("reads xsi:nil as null", async () => {
		const nullable = xmlResponse({ type: "object", properties: { note: { type: ["string", "null"] } } }, {});
		const outcome = await validate(
			nullable,
			`<r xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><note xsi:nil="true"/></r>`,
		);
		expect(outcome).toEqual({ success: true, value: { note: null } });
	});

	it("never expands DOCTYPE entities", async () => {
		const outcome = await read(
			`<!DOCTYPE pet [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY a "boom">]><pet><name>&xxe;&a;</name></pet>`,
		);
		expect(outcome).toMatchObject({ success: true, value: { name: "&xxe;&a;" } });
	});

	it("reports schema violations with paths", async () => {
		const outcome = await read(`<pet><name>Rex</name><category><id>nope</id></category></pet>`);
		expect(outcome.success).toBe(false);
		if (!outcome.success) expect(outcome.issues.map((i) => (i.path ?? []).join("."))).toContain("category.id");
	});

	it.each([
		["not xml", "no root element"],
		["<pet><name>Rex</pet>", "Expected </name>"],
		["<pet>", "Unclosed element"],
		["<a/><b/>", "More than one root"],
		["<!-- never closed", "Unterminated comment"],
		[`${"<a>".repeat(300)}`, "nested deeper"],
	])("rejects malformed input %j", async (xml, message) => {
		const outcome = await read(xml);
		expect(outcome.success).toBe(false);
		if (!outcome.success) expect(outcome.issues[0]!.message).toContain("Malformed XML");
		if (!outcome.success && message !== "no root element") expect(outcome.issues[0]!.message).toContain(message);
	});

	it("rejects non-text input", async () => {
		const outcome = await read({ name: "Rex" });
		expect(outcome.success).toBe(false);
	});
});

describe("xmlBody", () => {
	it("writes attributes, elements, wrapped and unwrapped arrays", async () => {
		const outcome = await write({
			id: 7,
			name: "Rex",
			category: { id: 2, name: "Dogs" },
			tags: ["a", "b"],
			photos: ["p1", "p2"],
			available: false,
		});
		expect(outcome).toEqual({
			success: true,
			value:
				'<pet id="7"><name>Rex</name><category><id>2</id><name>Dogs</name></category>' +
				"<tags><tag>a</tag><tag>b</tag></tags><photo>p1</photo><photo>p2</photo><available>false</available></pet>",
		});
	});

	it("escapes text and attribute values", async () => {
		const outcome = await validate(
			xmlBody(
				{ type: "object", properties: { v: { type: "string", xml: { attribute: true } }, t: { type: "string" } } },
				{},
				{ root: "r" },
			),
			{ v: 'a"<&', t: "1 < 2 & 3 > 2" },
		);
		expect(outcome).toEqual({ success: true, value: '<r v="a&quot;&lt;&amp;"><t>1 &lt; 2 &amp; 3 &gt; 2</t></r>' });
	});

	it("applies prefix and namespace", async () => {
		const outcome = await validate(
			xmlBody({
				type: "object",
				xml: { name: "order", prefix: "o", namespace: "urn:orders" },
				properties: { id: { type: "integer" } },
			}),
			{ id: 1 },
		);
		expect(outcome).toEqual({ success: true, value: '<o:order xmlns:o="urn:orders"><id>1</id></o:order>' });
	});

	it("uses the given root name and writes empty objects as empty elements", async () => {
		expect(await write({ name: "x" }, "animal")).toMatchObject({ value: "<pet><name>x</name></pet>" });
		const empty = await validate(xmlBody({ type: "object" }, {}, { root: "empty" }), {});
		expect(empty).toEqual({ success: true, value: "<empty/>" });
	});

	it("validates before writing", async () => {
		const outcome = await write({ id: 1 });
		expect(outcome.success).toBe(false);
	});

	it("round-trips through xmlResponse", async () => {
		const value = { id: 3, name: "Tom & Jerry", category: { id: 1, name: "Cats" }, tags: ["x"], photos: ["a", "b"] };
		const written = await write(value);
		expect(written.success).toBe(true);
		if (written.success) expect(await read(written.value)).toEqual({ success: true, value });
	});
});
