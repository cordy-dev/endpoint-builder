import { defineConfig } from "tsdown";

export default defineConfig([
	{
		entry: {
			index: "./src/index.ts",
			auth: "./src/auth/index.ts",
			retry: "./src/retry/index.ts",
			errors: "./src/errors/index.ts",
			testing: "./src/testing/index.ts",
			openapi: "./src/openapi/index.ts",
		},
		platform: "neutral",
		dts: true,
		sourcemap: true,
		minify: true,
	},
	{
		// the generator and its command line run on Node and are not part of what apps bundle
		entry: {
			codegen: "./src/codegen/index.ts",
			cli: "./src/codegen/bin.ts",
		},
		platform: "node",
		fixedExtension: false,
		dts: { resolve: false },
		sourcemap: true,
		clean: false,
	},
]);
