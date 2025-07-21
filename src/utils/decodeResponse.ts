import type { HttpRequestConfig } from "../types";

/**
 * Decode response body based on response type and content type
 * @param response - Fetch Response object
 * @param config - Request configuration
 * @returns Decoded response body
 */
export async function decodeResponse<T>(response: Response, config: HttpRequestConfig): Promise<T> {
	// Handle empty responses (204 No Content or empty body)
	if (response.status === 204 || response.headers.get("Content-Length") === "0") {
		return undefined as unknown as T;
	}

	// Prioritize explicit response type from request config
	const responseType = config.responseType;

	if (responseType) {
		switch (responseType) {
			case "text":
				return await response.text() as unknown as T;
			case "blob":
				return await response.blob() as unknown as T;
			case "arraybuffer":
				return await response.arrayBuffer() as unknown as T;
			case "stream":
				return response.body! as unknown as T;
		}
	}

	// Auto-detect based on Content-Type header
	const contentType = response.headers.get("Content-Type") ?? "";

	// JSON response
	if (contentType.includes("application/json")) {
		return await response.json() as T;
	}

	// Text response
	if (contentType.startsWith("text/")) {
		return await response.text() as unknown as T;
	}

	// Default to blob for binary data
	return await response.blob() as unknown as T;
}