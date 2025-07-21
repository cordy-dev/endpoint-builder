import type { HttpRequestConfig } from "../types";

export async function decodeResponse<T>(res: Response, cfg: HttpRequestConfig): Promise<T> {
	// Обрабатываем 204 No Content и другие случаи с пустым телом
	if (res.status === 204 || res.headers.get("Content-Length") === "0") {
		return undefined as unknown as T;
	}

	const explicit = cfg.responseType;
	if (explicit === "text")
		return await res.text() as unknown as T;

	if (explicit === "blob")
		return await res.blob() as unknown as T;

	if (explicit === "arraybuffer")
		return await res.arrayBuffer() as unknown as T;
	if (explicit === "stream")
		return res.body! as unknown as T;

	const contentType = res.headers.get("Content-Type") ?? "";
	if (contentType.includes("application/json"))
		return (await res.json()) as T;

	if (contentType.startsWith("text/"))
		return (await res.text()) as unknown as T;

	return (await res.blob()) as unknown as T;
}