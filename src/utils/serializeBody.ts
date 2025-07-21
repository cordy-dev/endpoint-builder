import type { HttpHeaders } from "../types";

export function serializeBody<B>(body: B, headers: HttpHeaders): B | string | undefined {
	if (body === undefined || body === null) return undefined;

	// Не преобразовываем веб-API объекты
	if (body instanceof FormData ||
	    body instanceof Blob ||
	    body instanceof ArrayBuffer ||
	    body instanceof ReadableStream) {
		return body;
	}

	// Проверка заголовка Content-Type (в любом регистре)
	const contentTypeHeader = Object.keys(headers).find(
		k => k.toLowerCase() === "content-type"
	);
	const ct = contentTypeHeader ? headers[contentTypeHeader] as string | undefined : undefined;

	// Отправляем JSON, если в заголовках указан application/json или это объект (но не FormData и не другие бинарные типы)
	const sendJson = ct?.includes("application/json") ?? (typeof body === "object");
	return sendJson ? JSON.stringify(body) : body;
}