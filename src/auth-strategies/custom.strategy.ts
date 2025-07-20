import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";

/**
 * Custom authentication adapter with custom headers
 */
export class CustomAuthStrategy implements AuthStrategy {
	constructor(
		private getCustomHeaders: () => Record<string, string> | Promise<Record<string, string>>
	) {}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		const customHeaders = await this.getCustomHeaders();

		// Handle empty headers gracefully
		if (!customHeaders || typeof customHeaders !== "object") {
			return config;
		}

		config.headers = config.headers || {};
		Object.assign(config.headers, customHeaders);
		return config;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401 || error.status === 403;
	}
}