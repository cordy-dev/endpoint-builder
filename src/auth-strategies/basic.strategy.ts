import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";

/**
 * Basic authentication adapter
 */
export class BasicAuthStrategy implements AuthStrategy {
	constructor(
		private getCredentials: () => { username: string; password: string } | Promise<{ username: string; password: string }>
	) {}

	private async getUsername(): Promise<string> {
		const credentials = await this.getCredentials();
		return credentials.username;
	}

	private async getPassword(): Promise<string> {
		const credentials = await this.getCredentials();
		return credentials.password;
	}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		const username = await this.getUsername();
		const password = await this.getPassword();

		if (!username || !password) {
			return config;
		}

		const credentials = btoa(`${username}:${password}`);
		config.headers = config.headers || {};
		config.headers["Authorization"] = `Basic ${credentials}`;
		return config;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401;
	}
}