import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		index: "./src/index.ts",
		auth: "./src/auth/index.ts",
		retry: "./src/retry/index.ts",
		errors: "./src/errors/index.ts",
		testing: "./src/testing/index.ts",
	},
	platform: "neutral",
	dts: true,
	sourcemap: true,
	minify: true,
});
