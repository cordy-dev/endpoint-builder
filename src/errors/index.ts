export { HttpError } from "./HttpError";
export { NetworkError } from "./NetworkError";
export { ValidationError } from "./ValidationError";

import type { HttpError } from "./HttpError";
import type { NetworkError } from "./NetworkError";
import type { ValidationError } from "./ValidationError";

/**
 * Union type of all API errors
 */
export type ApiError = HttpError | ValidationError | NetworkError;
