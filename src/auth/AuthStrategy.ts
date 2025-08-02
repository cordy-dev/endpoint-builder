import type { HttpHeaders } from "../types";

export interface AuthStrategy {
  /**
   * Enriches the request with authentication headers or query parameters.
   * Must be idempotent: can be called before and after 401.
   *
   * @param req - The request to enrich with authentication data
   * @returns Headers/params to add to the request
   */
  enrichRequest(req: Request): Promise<Partial<HttpHeaders>>;

  /**
   * Handles authentication errors (401/403) by refreshing tokens or re-authenticating.
   * Called when a request fails with authentication-related status codes.
   *
   * @param req - The original request that failed
   * @param res - The error response (401/403)
   * @returns true if auth was updated and request should be retried, false otherwise
   */
  handleRequestError?(req: Request, res: Response): Promise<boolean>;
}