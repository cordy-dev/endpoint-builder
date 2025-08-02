import type { PersistStorage } from "../storage/PersistStorage";
import type { HttpHeaders } from "../types";
import type { AuthStrategy } from "./AuthStrategy";

export interface OpaqueTokens { access: string; refresh?: string; }

export class OpaqueTokenStrategy implements AuthStrategy {
	constructor(
		private storage: PersistStorage,
		private refreshEndpoint: string,
		private headerName = "Authorization",
	) {}

	private async _fetchTokens(): Promise<OpaqueTokens | undefined> {
		return this.storage.get<OpaqueTokens>("tokens");
	}
	private async _saveTokens(t: OpaqueTokens) {
		await this.storage.set("tokens", t);
	}

	/**
	 * Enriches the request with Bearer token authentication.
	 * Adds the access token to the Authorization header.
	 */
	async enrichRequest(_req: Request): Promise<Partial<HttpHeaders>> {
		const tokens = await this._fetchTokens();
		return tokens?.access ? { [this.headerName]: `Bearer ${tokens.access}` } : {};
	}

	/**
	 * Handles authentication errors by attempting to refresh the access token.
	 * Called when the server returns 401 or 403 status codes.
	 *
	 * @returns true if the token was successfully refreshed and the request should be retried
	 */
	async handleRequestError(_req: Request, res: Response): Promise<boolean> {
		if (res.status !== 401 && res.status !== 403) return false;
		const tokens = await this._fetchTokens();
		if (!tokens?.refresh) return false;

		const r = await fetch(this.refreshEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: tokens.refresh }),
		});
		if (!r.ok) return false;
		const json = (await r.json()) as OpaqueTokens;
		if (!json.access) return false;

		await this._saveTokens(json);
		return true;
	}
}
