import ts from "typescript";

export interface TypecheckOptions {
	/** Extra module name -> file path mappings (for example the library sources) */
	paths?: Record<string, string>;
}

/**
 * Type-check in-memory files with the real TypeScript compiler.
 * File names are relative ("types.ts", "usage.ts") and may import each other with "./types".
 * @returns one string per diagnostic, empty when everything is fine
 */
export function typecheck(files: Record<string, string>, options: TypecheckOptions = {}): string[] {
	const root = "/virtual/";
	const virtual = new Map(Object.entries(files).map(([name, text]) => [root + name, text]));
	const compilerOptions: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
		types: [],
		skipLibCheck: true,
		noUncheckedIndexedAccess: true,
		baseUrl: "/",
		paths: Object.fromEntries(Object.entries(options.paths ?? {}).map(([name, path]) => [name, [path]])),
	};

	const host = ts.createCompilerHost(compilerOptions);
	const real = {
		directoryExists: host.directoryExists?.bind(host),
		fileExists: host.fileExists.bind(host),
		readFile: host.readFile.bind(host),
		getSourceFile: host.getSourceFile.bind(host),
	};
	// module resolution only looks inside directories that exist
	host.directoryExists = dir => dir === "/virtual" || dir === "/virtual/" || real.directoryExists?.(dir) === true;
	host.fileExists = file => virtual.has(file) || real.fileExists(file);
	host.readFile = file => virtual.get(file) ?? real.readFile(file);
	host.getSourceFile = (file, languageVersion, ...rest) => {
		const text = virtual.get(file);
		return text === undefined ? real.getSourceFile(file, languageVersion, ...rest) : ts.createSourceFile(file, text, languageVersion);
	};

	const program = ts.createProgram([...virtual.keys()], compilerOptions, host);
	return ts.getPreEmitDiagnostics(program)
		.filter(diagnostic => diagnostic.file === undefined || virtual.has(diagnostic.file.fileName))
		.map((diagnostic) => {
			const where = diagnostic.file && diagnostic.start !== undefined
				? `${diagnostic.file.fileName.replace(root, "")}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
				: "global";
			return `${where} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
		});
}
