// ========================================
// UNIVERSAL API (RECOMMENDED)
// ========================================

export type { UniversalClientOptions } from "./simple";
export { createClient } from "./simple";

// ========================================
// DIRECT ACCESS TO CLASSES (ADVANCED)
// ========================================

// Core
export { HttpClient } from "./core/HttpClient";
export { RequestBuilder } from "./core/RequestBuilder";

// Authentication
export { ApiKeyStrategy } from "./auth/ApiKeyStrategy";
export type { AuthStrategy } from "./auth/AuthStrategy";
export { OpaqueTokenStrategy } from "./auth/OpaqueTokenStrategy";

// Retry Strategies
export { ExponentialRetryStrategy as JitteredExponentialBackoffRetryStrategy } from "./retry/ExponentialRetryStrategy";
export type { RetryStrategy } from "./retry/RetryStrategy";

// Storage
export { LocalStoragePersist } from "./storage/LocalStoragePersist";
export { MemoryStoragePersist } from "./storage/MemoryStoragePersist";
export type { PersistStorage } from "./storage/PersistStorage";

// Types
export type {
	HttpError,
	HttpHeaders,
	HttpMethod,
	HttpRequestConfig,
	HttpResponse,
	ResponseType
} from "./types";

// Backward compatibility exports
export type { UniversalClientOptions as SimpleClientOptions } from "./simple";
export { UniversalClient as SimpleClient } from "./simple";