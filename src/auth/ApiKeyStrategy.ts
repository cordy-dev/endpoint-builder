import type { HttpHeaders } from "../types";
import type { AuthStrategy } from "./AuthStrategy";

export class ApiKeyStrategy implements AuthStrategy {
	constructor(
		private headerName: string = "X-API-Key",
		private key: string,
		private asQueryParam = false,
	) {}

	enrich(req: Request): Promise<Partial<HttpHeaders>> {
		if (this.asQueryParam) {
			const u = new URL(req.url);
			u.searchParams.set(this.headerName, this.key);
			Object.defineProperty(req, "url", { value: u.toString() });
			return Promise.resolve({});
		}
		return Promise.resolve({ [this.headerName]: this.key });
	}
}