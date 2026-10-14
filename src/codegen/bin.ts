#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runCli } from "./cli";

process.exitCode = await runCli(process.argv.slice(2), {
	readFile: (path) => readFile(path, "utf8"),
	async readFileIfExists(path) {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	},
	async writeFile(path, content) {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content);
	},
	async fetchText(url) {
		const response = await fetch(url, { headers: { accept: "application/json" } });
		if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}`);
		return response.text();
	},
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
});
