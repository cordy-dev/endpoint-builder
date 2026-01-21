import type { HttpHeaders } from "../types";
import type { AuthStrategy } from "./AuthStrategy";

/**
 * Create a Bearer token authentication strategy
 * @param token - Static token string or function that returns token (sync or async)
 */
export function bearerAuth(
	token: string | (() => string | Promise<string>)
): AuthStrategy {
	return {
		async enrichRequest(_req: Request): Promise<Partial<HttpHeaders>> {
			const resolvedToken = typeof token === "function" ? await token() : token;
			return { Authorization: `Bearer ${resolvedToken}` };
		},
	};
}

/**
 * Create an API Key authentication strategy
 * @param key - Static API key or function that returns key (sync or async)
 * @param headerName - Header name to use (default: "X-API-Key")
 */
export function apiKeyAuth(
	key: string | (() => string | Promise<string>),
	headerName = "X-API-Key"
): AuthStrategy {
	return {
		async enrichRequest(_req: Request): Promise<Partial<HttpHeaders>> {
			const resolvedKey = typeof key === "function" ? await key() : key;
			return { [headerName]: resolvedKey };
		},
	};
}

/**
 * Create a Basic authentication strategy
 * @param username - Username for basic auth
 * @param password - Password for basic auth
 */
export function basicAuth(username: string, password: string): AuthStrategy {
	const credentials = btoa(`${username}:${password}`);
	return {
		enrichRequest(_req: Request): Promise<Partial<HttpHeaders>> {
			return Promise.resolve({ Authorization: `Basic ${credentials}` });
		},
	};
}

/**
 * Options for refresh token authentication
 */
export interface RefreshAuthOptions {
	/** Function to get current access token */
	getToken: () => string | Promise<string>;
	/** Function to get refresh token */
	getRefreshToken: () => string | Promise<string>;
	/** Function to refresh the token, should update internal state and return new token */
	refresh: (refreshToken: string) => Promise<string>;
	/** Function to determine if response should trigger refresh (default: status 401) */
	shouldRefresh?: (response: Response) => boolean;
}

/**
 * Create a refresh token authentication strategy
 * Automatically refreshes token on 401 responses (or custom condition)
 * @param options - Refresh auth configuration
 */
export function refreshAuth(options: RefreshAuthOptions): AuthStrategy {
	const {
		getToken,
		getRefreshToken,
		refresh,
		shouldRefresh = (r) => r.status === 401,
	} = options;

	return {
		async enrichRequest(_req: Request): Promise<Partial<HttpHeaders>> {
			const token = await getToken();
			return { Authorization: `Bearer ${token}` };
		},

		async handleRequestError(_req: Request, res: Response): Promise<boolean> {
			if (!shouldRefresh(res)) {
				return false;
			}

			const refreshToken = await getRefreshToken();
			await refresh(refreshToken);
			return true;
		},
	};
}
