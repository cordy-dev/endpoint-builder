import type { AuthStrategy, HttpError, HttpRequestConfig } from "../core/types";

/**
 * Opaque Token Auth Strategy with token refresh capability
 */
export class OpaqueTokenAuthStrategy implements AuthStrategy {
	private currentToken?: string;
	private refreshPromise?: Promise<string>;

	constructor(
		private getToken: () => string | Promise<string>,
		private refreshToken?: () => Promise<string>,
		private isTokenValid?: (token: string) => boolean | Promise<boolean>,
		private headerName: string = "Authorization",
		private tokenPrefix: string = "Bearer"
	) {}

	async applyAuth(config: HttpRequestConfig): Promise<HttpRequestConfig> {
		const token = await this.getValidToken();
		if (token) {
			config.headers = config.headers || {};
			config.headers[this.headerName] = `${this.tokenPrefix} ${token}`;
		}
		return config;
	}

	isAuthError(error: HttpError): boolean {
		return error.status === 401 || error.status === 403;
	}

	async handleAuthError(error: HttpError): Promise<HttpRequestConfig | null> {
		// Если есть функция refresh и это 401 ошибка, попробуем обновить токен
		if (this.refreshToken && error.status === 401) {
			try {
				const newToken = await this.performTokenRefresh();
				this.currentToken = newToken;

				// Повторяем оригинальный запрос с новым токеном
				if (error.config) {
					error.config.headers = error.config.headers || {};
					error.config.headers[this.headerName] = `${this.tokenPrefix} ${newToken}`;
					return error.config;
				}
			} catch (refreshError) {
				console.error("Token refresh failed:", refreshError);
				// Можно добавить колбек для обработки неудачного refresh (например, редирект на логин)
			}
		}
		return null;
	}

	/**
	 * Get valid token with automatic refresh if needed
	 */
	private async getValidToken(): Promise<string> {
		// Если уже есть токен и он валидный, используем его
		if (this.currentToken && await this.isTokenStillValid(this.currentToken)) {
			return this.currentToken;
		}

		// Если refresh уже идет, ждем его завершения
		if (this.refreshPromise) {
			return await this.refreshPromise;
		}

		// Получаем токен из getToken()
		const token = await this.getToken();

		// Проверяем пустой токен
		if (!token || (typeof token === "string" && token.trim() === "")) {
			return "";
		}

		this.currentToken = typeof token === "string" ? token : token;

		// Проверяем валидность полученного токена
		if (await this.isTokenStillValid(this.currentToken)) {
			return this.currentToken;
		}

		// Если токен не валидный, пытаемся обновить
		if (this.refreshToken) {
			try {
				return await this.performTokenRefresh();
			} catch (refreshError) {
				console.error("Token refresh failed:", refreshError);
				// Возвращаем текущий токен как fallback
				return this.currentToken;
			}
		}

		// Возвращаем текущий токен если нет функции refresh
		return this.currentToken;
	}

	/**
	 * Perform token refresh with deduplication
	 */
	private async performTokenRefresh(): Promise<string> {
		// Если refresh уже выполняется, возвращаем существующий Promise
		if (this.refreshPromise) {
			return await this.refreshPromise;
		}

		// Создаем новый Promise для refresh
		this.refreshPromise = this.executeTokenRefresh();

		try {
			const newToken = await this.refreshPromise;
			return newToken;
		} finally {
			// Очищаем Promise после завершения
			this.refreshPromise = undefined;
		}
	}

	private async executeTokenRefresh(): Promise<string> {
		if (!this.refreshToken) {
			throw new Error("No refresh function provided");
		}

		return await this.refreshToken();
	}

	private async isTokenStillValid(token: string): Promise<boolean> {
		if (!this.isTokenValid) {
			return true; // Если нет функции валидации, считаем токен валидным
		}

		const result = this.isTokenValid(token);
		return typeof result === "boolean" ? result : await result;
	}

	/**
	 * Manually set current token
	 */
	setToken(token: string): void {
		this.currentToken = token;
		this.refreshPromise = undefined; // Clear any ongoing refresh
	}

	/**
	 * Manually invalidate current token (useful for logout)
	 */
	invalidateToken(): void {
		this.currentToken = undefined;
		this.refreshPromise = undefined;
	}
}
