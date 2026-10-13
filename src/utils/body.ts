/** Body that is passed to `fetch` untouched */
export function isNativeBody(value: unknown): value is BodyInit {
	return (
		typeof value === "string" ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value) ||
		(typeof Blob !== "undefined" && value instanceof Blob) ||
		(typeof FormData !== "undefined" && value instanceof FormData) ||
		value instanceof URLSearchParams ||
		(typeof ReadableStream !== "undefined" && value instanceof ReadableStream)
	);
}

export function isStream(value: unknown): value is ReadableStream {
	return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

export type FormValue = string | number | boolean | bigint | Blob | null | undefined;
export type FormInput = Record<string, FormValue | readonly FormValue[]>;

export function toFormData(input: FormInput | FormData): FormData {
	if (input instanceof FormData) return input;
	const form = new FormData();
	for (const [key, value] of Object.entries(input)) {
		const values = Array.isArray(value) ? value : [value];
		for (const item of values as FormValue[]) {
			if (item === undefined || item === null) continue;
			if (typeof Blob !== "undefined" && item instanceof Blob) form.append(key, item);
			else form.append(key, String(item as string));
		}
	}
	return form;
}

export function toUrlEncoded(input: FormInput | URLSearchParams): URLSearchParams {
	if (input instanceof URLSearchParams) return input;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(input)) {
		const values = Array.isArray(value) ? value : [value];
		for (const item of values as FormValue[]) {
			if (item === undefined || item === null) continue;
			params.append(key, String(item as string));
		}
	}
	return params;
}
