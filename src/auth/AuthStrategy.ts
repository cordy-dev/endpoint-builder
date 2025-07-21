import type { HttpHeaders } from "../types";

export interface AuthStrategy {
  /**
   * Returns headers/params that need to be added to the request.
   * Must be idempotent: can be called before and after 401.
   */
  enrich(req: Request): Promise<Partial<HttpHeaders>>;
  /** Updates token if server returned 401/403. */
  refresh?(req: Request, res: Response): Promise<boolean>;
}