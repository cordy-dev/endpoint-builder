import { fileURLToPath } from "node:url";

import { coverageConfigDefaults, defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
	resolve: {
		// generated clients import the library by its package name
		alias: [
			{ find: /^@cordy\/endpoint-builder\/(.+)$/, replacement: src("$1/index.ts") },
			{ find: /^@cordy\/endpoint-builder$/, replacement: src("index.ts") },
		],
	},
	test: {
		// use 'github-actions' reporter if running in GitHub Actions
		reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
		coverage: {
			reporter: ["text", "lcov"],
			provider: "v8",
			clean: true,
			include: ["src/**/*.ts"], // Include all TypeScript files in the src directory
			// Extend the default exclude patterns to exclude test files
			exclude: [...coverageConfigDefaults.exclude, "**/*.spec.ts", "**/*.test.ts"],
		},
	},
});
