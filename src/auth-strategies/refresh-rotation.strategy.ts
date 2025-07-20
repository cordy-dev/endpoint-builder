import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";


/**
 * Refreshable Bearer token authentication adapter with request deduplication
 */
export interface RefreshRotationProvider {
	getToken(): string | Promise<string>;
	refreshToken(): Promise<string>;
	isTokenValid?(token: string): boolean;
}

export class RefreshRotationStrategy implements AuthStrategy {
	private currentToken?: string;
	private refreshPromise?: Promise<string>;

	constructor(private tokenProvider: RefreshRotationProvider) {}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		let token = this.currentToken;

		// Check if we need to get/refresh token
		if (!token || (this.tokenProvider.isTokenValid && !this.tokenProvider.isTokenValid(token))) {
			token = await this.refreshToken();
		}

		// Handle empty token gracefully
		if (!token || (typeof token === "string" && token.trim() === "")) {
			return config;
		}

		config.headers = config.headers || {};
		config.headers["Authorization"] = `Bearer ${token}`;
		return config;
	}

	private async refreshToken(): Promise<string> {
		// Deduplicate concurrent refresh attempts
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		this.refreshPromise = this.tokenProvider.refreshToken()
			.then(token => {
				this.currentToken = token;
				return token;
			})
			.finally(() => {
				this.refreshPromise = undefined;
			});

		return this.refreshPromise;
	}

	async handleAuthError(error: HttpError): Promise<HttpRequestConfig | null> {
		if (!this.isAuthError(error)) return null;

		// Clear current token and refresh
		this.currentToken = undefined;

		try {
			const newToken = await this.refreshToken();
			if (newToken && error.config) {
				const newConfig = { ...error.config };
				newConfig.headers = {
					...newConfig.headers,
					"Authorization": `Bearer ${newToken}`
				};
				return newConfig;
			}
		} catch (refreshError) {
			console.warn("Token refresh failed:", refreshError);
		}

		return null;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401;
	}

	/**
	 * Manually invalidate current token
	 */
	invalidateToken(): void {
		this.currentToken = undefined;
		this.refreshPromise = undefined;
	}
}
