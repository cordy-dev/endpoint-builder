import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";

/**
 * API Key authentication adapter
 */
export class ApiKeyAuthStrategy implements AuthStrategy {
	constructor(
		private getApiKey: () => string | Promise<string>,
		private headerName = "X-API-Key"
	) {}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		const apiKey = await this.getApiKey();

		// Handle empty API key gracefully
		if (!apiKey || (typeof apiKey === "string" && apiKey.trim() === "")) {
			return config;
		}

		config.headers = config.headers || {};
		config.headers[this.headerName] = apiKey;
		return config;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401 || error.status === 403;
	}
}