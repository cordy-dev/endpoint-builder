const RESERVED = new Set([
	"break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends",
	"false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this",
	"throw", "true", "try", "typeof", "var", "void", "while", "with", "yield", "let", "static", "implements", "interface", "package",
	"private", "protected", "public", "await", "async", "of", "type", "any", "unknown", "never", "string", "number", "boolean",
	"object", "symbol", "bigint", "undefined", "arguments", "eval",
]);

/** Globals that generated code relies on; a schema called `Blob` must not shadow them */
const GLOBALS = new Set([
	"Array", "Blob", "Boolean", "Date", "Error", "FormData", "Headers", "Map", "Number", "Object", "Partial", "Promise", "Readonly",
	"Record", "RegExp", "Request", "Response", "Set", "String", "Symbol", "File", "Uint8Array", "URL", "URLSearchParams",
]);

/** "getUser_ById", "get-user-by-id", "HTTPServer" -> ["get", "User", "By", "Id"], ["HTTP", "Server"] */
export function words(input: string): string[] {
	return input.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
}

export function pascalCase(input: string): string {
	return words(input).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
}

export function camelCase(input: string): string {
	const pascal = pascalCase(input);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Make `name` usable as a TypeScript identifier */
export function identifier(name: string, fallback = "_"): string {
	let id = name.replace(/[^\w$]/g, "");
	if (id === "") id = fallback;
	if (/^\d/.test(id)) id = `_${id}`;
	return RESERVED.has(id) ? `${id}_` : id;
}

/** Object key: bare when it is a valid identifier, quoted otherwise */
export function propertyKey(name: string): string {
	return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/** Hands out unique identifiers: a taken name gets a numeric suffix */
export class NameRegistry {
	readonly #taken = new Set<string>();

	constructor(taken: Iterable<string> = []) {
		for (const name of taken) this.#taken.add(name);
	}

	claim(preferred: string): string {
		let name = GLOBALS.has(preferred) ? `${preferred}_` : preferred;
		for (let n = 2; this.#taken.has(name); n++) name = `${preferred}${n}`;
		this.#taken.add(name);
		return name;
	}

	has(name: string): boolean {
		return this.#taken.has(name);
	}
}
