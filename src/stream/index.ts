import { AbortError, EndpointError, type ErrorRequest, NetworkError, ParseError, ValidationError } from "../errors";
import { type Schema, validate } from "../schema";

/** A raw Server-Sent Event */
export interface SseMessage {
	/** Event name (`"message"` when the server sent none) */
	readonly event: string;
	/** Data lines joined with `\n` */
	readonly data: string;
	/** Last event id seen on the stream */
	readonly id: string | undefined;
	/** Reconnection time in ms, when the server sent one */
	readonly retry: number | undefined;
}

export interface NdjsonOptions {
	/**
	 * What to do with a line / event that is not valid JSON or does not match the schema.
	 * `"throw"` (default) ends the stream with a `ParseError` / `ValidationError`, `"skip"` drops the item.
	 */
	onInvalid?: "throw" | "skip";
}

export interface SseOptions extends NdjsonOptions {
	/** End the stream when this returns true (or when `data` equals the string), e.g. `"[DONE]"` */
	stopOn?: string | ((message: SseMessage) => boolean);
}

/** @internal what a request needs to open a stream */
export interface StreamSpec {
	readonly kind: "sse" | "ndjson";
	readonly schema?: Schema | undefined;
	readonly options?: SseOptions | undefined;
}

/**
 * A one-shot async iterable over a response body. Breaking out of `for await`
 * (or calling `cancel()`) closes the connection.
 *
 * ```ts
 * const stream = await api.get("/chat").sse(ChatEvent);
 * for await (const event of stream) console.log(event);
 * ```
 */
export class EventStream<T> implements AsyncIterable<T> {
	readonly #iterator: AsyncGenerator<T, void, undefined>;
	readonly #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

	/** @internal */
	constructor(iterator: AsyncGenerator<T, void, undefined>, reader: ReadableStreamDefaultReader<Uint8Array> | undefined) {
		this.#iterator = iterator;
		this.#reader = reader;
	}

	[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
		return this.#iterator;
	}

	/** Close the connection without reading the rest */
	async cancel(reason?: unknown): Promise<void> {
		await this.#reader?.cancel(reason).catch(() => undefined);
		await this.#iterator.return();
	}

	/** Read the whole stream into an array */
	async toArray(): Promise<T[]> {
		const items: T[] = [];
		for await (const item of this) items.push(item);
		return items;
	}
}

// ------------------------------------------------------------------ parsing

/** Split a byte stream into lines. Handles `\n`, `\r\n` and a lone `\r`, also across chunk boundaries. */
async function* readLines(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, undefined> {
	const decoder = new TextDecoder();
	let buffer = "";
	let first = true;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		if (first && buffer.length > 0) {
			if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
			first = false;
		}

		let start = 0;
		for (let i = 0; i < buffer.length; i++) {
			const code = buffer.charCodeAt(i);
			if (code === 10) {
				yield buffer.slice(start, i);
				start = i + 1;
			} else if (code === 13) {
				if (i + 1 === buffer.length) break; // maybe the first half of \r\n
				yield buffer.slice(start, i);
				start = buffer.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
				i = start - 1;
			}
		}
		buffer = buffer.slice(start);
	}

	buffer += decoder.decode();
	// a trailing "\r" terminates a line (possibly an empty one, i.e. the blank line that ends an event)
	if (buffer.endsWith("\r")) yield buffer.slice(0, -1);
	else if (buffer.length > 0) yield buffer;
}

/** Assemble SSE messages from lines (https://html.spec.whatwg.org/multipage/server-sent-events.html) */
async function* readSse(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SseMessage, void, undefined> {
	let data: string[] = [];
	let event = "";
	let lastId: string | undefined;
	let retry: number | undefined;

	for await (const line of readLines(reader)) {
		if (line === "") {
			if (data.length > 0) yield { event: event || "message", data: data.join("\n"), id: lastId, retry };
			data = [];
			event = "";
			retry = undefined;
			continue;
		}
		if (line.charCodeAt(0) === 58) continue; // ":" comment / keep-alive

		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);

		switch (field) {
			case "data": data.push(value); break;
			case "event": event = value; break;
			case "id": if (!value.includes("\0")) lastId = value; break;
			case "retry": if (/^\d+$/.test(value)) retry = Number(value); break;
		}
	}
	// an event that is not terminated by a blank line is discarded, as the spec says
}

async function* readNdjson(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string, void, undefined> {
	for await (const line of readLines(reader)) {
		if (line.trim() !== "") yield line;
	}
}

// ---------------------------------------------------------------------- open

function toError(error: unknown, signal: AbortSignal | undefined, request: ErrorRequest): EndpointError {
	if (error instanceof EndpointError) return error;
	if (signal?.aborted) return new AbortError(request, signal.reason);
	const message = error instanceof Error ? error.message : String(error);
	return new NetworkError(`Stream interrupted: ${message} (${request.method} ${request.url})`, request, error);
}

/** @internal turn a successful response into a typed stream */
export function openStream(response: Response, request: ErrorRequest, signal: AbortSignal | undefined, spec: StreamSpec): EventStream<any> {
	const reader = response.body?.getReader();
	if (!reader) return new EventStream((async function* () { /* empty body */ })(), undefined);

	const { schema, options } = spec;
	const skip = options?.onInvalid === "skip";
	const stopOn = options?.stopOn;

	const parseItem = async (text: string): Promise<{ value: unknown } | undefined> => {
		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (cause) {
			if (skip) return undefined;
			throw new ParseError(`Malformed JSON in ${spec.kind === "sse" ? "event" : "line"} (${request.method} ${request.url})`, text, request, cause);
		}
		if (!schema) return { value: json };
		let outcome = validate(schema, json);
		if (outcome instanceof Promise) outcome = await outcome;
		if (outcome.success) return { value: outcome.value };
		if (skip) return undefined;
		throw new ValidationError("response", outcome.issues, json, request, outcome.cause);
	};

	async function* items(): AsyncGenerator<unknown, void, undefined> {
		try {
			if (spec.kind === "sse") {
				for await (const message of readSse(reader!)) {
					if (typeof stopOn === "string" ? message.data === stopOn : stopOn?.(message)) return;
					if (!schema) {
						yield message;
						continue;
					}
					const parsed = await parseItem(message.data);
					if (parsed) yield parsed.value;
				}
			} else {
				for await (const line of readNdjson(reader!)) {
					const parsed = await parseItem(line);
					if (parsed) yield parsed.value;
				}
			}
		} catch (error) {
			throw toError(error, signal, request);
		} finally {
			// not awaited: closing the connection must never block leaving a `for await` loop
			void reader!.cancel().catch(() => undefined);
		}
	}

	return new EventStream(items(), reader);
}
