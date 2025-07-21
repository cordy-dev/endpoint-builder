import type { HttpHeaders } from "../types";

export interface AuthStrategy {
  /**
   * Возвращает headers/params, которые нужно добавить к запросу.
   * Должен быть idempotent: можно вызывать до и после 401.
   */
  enrich(req: Request): Promise<Partial<HttpHeaders>>;
  /** Обновляет токен, если сервер вернул 401/403. */
  refresh?(req: Request, res: Response): Promise<boolean>;
}