import { type GenerateOptions, generate } from "./generate";
import { SpecError } from "./model";

/** What the command line needs from the outside world; tests pass fakes */
export interface CliIo {
	readFile(path: string): Promise<string>;
	/** `undefined` when the file does not exist */
	readFileIfExists(path: string): Promise<string | undefined>;
	writeFile(path: string, content: string): Promise<void>;
	fetchText(url: string): Promise<string>;
	stdout(text: string): void;
	stderr(text: string): void;
}

export const USAGE = `Usage: endpoint-builder generate <spec.json | https://...> [options]

Generates a typed client from an OpenAPI 3.0 / 3.1 or Swagger 2.0 document (JSON).

Options:
  -o, --out <file>         Write the client to this file (default: print to stdout)
      --check              Do not write; exit with 1 when --out is missing or out of date (for CI)
      --prefer <json|xml>  Format to use when an operation offers both (default: json)
      --group <tag|none>   Group operations by their first tag (default) or keep them flat
      --no-validate        Types only: no runtime validation of requests and responses
      --import-from <mod>  Module to import the library from (default: @cordy/endpoint-builder)
  -h, --help               Show this help
`;

interface Parsed {
	input: string;
	out?: string;
	check: boolean;
	options: GenerateOptions;
}

class UsageError extends Error {}

function parseArgs(args: readonly string[]): Parsed | "help" {
	const options: GenerateOptions = {};
	let input: string | undefined;
	let out: string | undefined;
	let check = false;

	const value = (flag: string, index: number): string => {
		const next = args[index + 1];
		if (next === undefined || next.startsWith("-")) throw new UsageError(`${flag} needs a value`);
		return next;
	};
	const choice = <const T extends string>(flag: string, text: string, allowed: readonly T[]): T => {
		if (!(allowed as readonly string[]).includes(text))
			throw new UsageError(`${flag} must be one of: ${allowed.join(", ")}`);
		return text as T;
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? splitFlag(arg) : [arg, undefined];
		const take = () => {
			if (inline !== undefined) return inline;
			const taken = value(flag, i);
			i++;
			return taken;
		};
		switch (flag) {
			case "-h":
			case "--help":
				return "help";
			case "-o":
			case "--out":
				out = take();
				break;
			case "--check":
				check = true;
				break;
			case "--no-validate":
				options.validate = false;
				break;
			case "--prefer":
				options.prefer = choice(flag, take(), ["json", "xml"]);
				break;
			case "--group":
				options.group = choice(flag, take(), ["tag", "none"]);
				break;
			case "--import-from":
				options.importFrom = take();
				break;
			default:
				if (flag.startsWith("-")) throw new UsageError(`Unknown option ${flag}`);
				if (input !== undefined) throw new UsageError(`Unexpected argument ${flag}`);
				input = flag;
		}
	}
	if (input === undefined) throw new UsageError("Which document? Pass a file path or an https:// URL");
	if (check && out === undefined)
		throw new UsageError("--check needs --out: it compares that file with a fresh result");
	return { input, check, options, ...(out === undefined ? {} : { out }) };
}

function splitFlag(arg: string): [string, string] {
	const at = arg.indexOf("=");
	return [arg.slice(0, at), arg.slice(at + 1)];
}

function parseJson(text: string, source: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		const looksLikeYaml = /^\s*(openapi|swagger)\s*:/m.test(text) || /\.ya?ml$/i.test(source);
		throw new SpecError(
			looksLikeYaml
				? `${source} is YAML. Only JSON is supported: convert it first (for example \`npx js-yaml ${source} > openapi.json\`)`
				: `${source} is not valid JSON: ${(cause as Error).message}`,
		);
	}
}

/**
 * Run `endpoint-builder <command> ...`. Returns the exit code instead of exiting, so it can be tested.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
	const [command, ...rest] = argv;
	if (command === undefined || command === "-h" || command === "--help" || command === "help") {
		io.stdout(USAGE);
		return command === undefined ? 1 : 0;
	}
	if (command !== "generate") {
		io.stderr(`Unknown command "${command}"\n\n${USAGE}`);
		return 1;
	}

	try {
		const parsed = parseArgs(rest);
		if (parsed === "help") {
			io.stdout(USAGE);
			return 0;
		}
		const remote = /^https?:\/\//i.test(parsed.input);
		const text = remote ? await io.fetchText(parsed.input) : await io.readFile(parsed.input);
		const { code, warnings } = generate(parseJson(text, parsed.input), { source: parsed.input, ...parsed.options });
		for (const warning of warnings) io.stderr(`warning: ${warning}\n`);

		if (parsed.out === undefined) {
			io.stdout(code);
			return 0;
		}
		if (parsed.check) {
			const current = await io.readFileIfExists(parsed.out);
			if (current === code) return 0;
			io.stderr(
				`${parsed.out} is ${current === undefined ? "missing" : "out of date"}. Run: endpoint-builder generate ${parsed.input} --out ${parsed.out}\n`,
			);
			return 1;
		}
		await io.writeFile(parsed.out, code);
		io.stderr(`wrote ${parsed.out}\n`);
		return 0;
	} catch (error) {
		if (error instanceof UsageError) {
			io.stderr(`${error.message}\n\n${USAGE}`);
		} else if (error instanceof SpecError) {
			io.stderr(`error: ${error.message}\n`);
		} else {
			io.stderr(`error: ${error instanceof Error ? error.message : String(error)}\n`);
		}
		return 1;
	}
}
