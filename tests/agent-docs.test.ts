import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildLlmsFull } from "../scripts/build-llms";
import * as lib from "../src";
import * as testing from "../src/testing";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json")) as { files: string[]; scripts: Record<string, string>; exports: Record<string, unknown> };

describe("documentation for AI agents", () => {
	it("llms-full.txt is generated from README.md and MIGRATION.md (run `npm run docs:llms`)", () => {
		expect(read("llms-full.txt")).toBe(buildLlmsFull());
	});

	it("is shipped in the package", () => {
		expect(pkg.files).toEqual(expect.arrayContaining(["dist", "llms.txt", "llms-full.txt"]));
		for (const file of pkg.files.filter(f => f !== "dist")) expect(existsSync(new URL(`../${file}`, import.meta.url))).toBe(true);
	});

	it("llms.txt only links to files that exist", () => {
		const links = [...read("llms.txt").matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]!);
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) expect(existsSync(new URL(`../${link}`, import.meta.url)), link).toBe(true);
	});

	it("llms.txt names real exports", () => {
		const text = read("llms.txt");
		const main = ["createClient", "endpoint", "defineContract", "schema", "isHttpError", "bearer", "apiKey", "basic", "refreshable"];
		for (const name of main) {
			expect(text, name).toContain(name);
			expect(lib, name).toHaveProperty(name);
		}
		for (const name of ["mockClient", "mockFetch"]) {
			expect(text, name).toContain(name);
			expect(testing, name).toHaveProperty(name);
		}
		for (const subpath of ["/auth", "/retry", "/errors", "/testing"]) expect(pkg.exports, subpath).toHaveProperty(`.${subpath}`);
	});

	it("llms.txt lists exactly the error types of the README table", () => {
		const rules = read("llms.txt");
		const listed = /`http`, `network`.*?`size`/.exec(rules)![0].match(/`(\w+)`/g)!.map(s => s.slice(1, -1));
		const section = read("README.md").split("## Errors and `.safe()`")[1]!.split("\n## ")[0]!;
		const table = [...section.matchAll(/^\| `\w+(?:<[^`]*>)?` \| `(\w+)` \|/gm)].map(match => match[1]);
		expect(listed.sort()).toEqual(table.sort());
	});

	it("AGENTS.md only mentions npm scripts that exist", () => {
		const scripts = [...read("AGENTS.md").matchAll(/npm (?:run )?([\w:-]+)/g)].map(match => match[1]!);
		expect(scripts.length).toBeGreaterThan(0);
		for (const script of scripts) expect(pkg.scripts, script).toHaveProperty(script);
	});

	it("CLAUDE.md pulls in AGENTS.md", () => {
		expect(read("CLAUDE.md").trim()).toBe("@AGENTS.md");
	});
});
