import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";

/**
 * Bearer token authentication strategy
 */
export class BearerAuthStrategy implements AuthStrategy {
	constructor(private getToken: () => string | Promise<string>) {}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		const token = await this.getToken();

		// Handle empty token gracefully
		if (!token || (typeof token === "string" && token.trim() === "")) {
			return config;
		}

		config.headers = config.headers || {};
		config.headers["Authorization"] = `Bearer ${token}`;
		return config;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401;
	}
}