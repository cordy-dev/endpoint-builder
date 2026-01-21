// ========================================
// TYPED API (RECOMMENDED)
// ========================================

export type { TypedClientOptions, TypedRequestOptions } from "./client";
export { createClient, TypedClient } from "./client";

// ========================================
// LEGACY UNIVERSAL API
// ========================================

export type { UniversalClientOptions } from "./simple";
export { createClient as createUniversalClient, UniversalClient } from "./simple";

// ========================================
// DIRECT ACCESS TO CLASSES (ADVANCED)
// ========================================

// Core
export type { HttpClientOptions } from "./core/HttpClient";
export { HttpClient } from "./core/HttpClient";
export { RequestBuilder, SchemaRequestBuilder, TransformRequestBuilder } from "./core/RequestBuilder";

// Authentication
export { ApiKeyStrategy } from "./auth/ApiKeyStrategy";
export type { AuthStrategy } from "./auth/AuthStrategy";
export type { RefreshAuthOptions } from "./auth/helpers";
export { apiKeyAuth, basicAuth, bearerAuth, refreshAuth } from "./auth/helpers";
export { OpaqueTokenStrategy } from "./auth/OpaqueTokenStrategy";

// Errors
export type { ApiError } from "./errors";
export { HttpError, NetworkError,ValidationError } from "./errors";

// Retry Strategies
export { ExponentialRetryStrategy } from "./retry/ExponentialRetryStrategy";
export { ExponentialRetryStrategy as JitteredExponentialBackoffRetryStrategy } from "./retry/ExponentialRetryStrategy";
export type { RetryContext, RetryStrategy } from "./retry/RetryStrategy";

// Storage
export { LocalStoragePersist } from "./storage/LocalStoragePersist";
export { MemoryStoragePersist } from "./storage/MemoryStoragePersist";
export type { PersistStorage } from "./storage/PersistStorage";

// Types
export type {
	BodyLike,
	HttpError as HttpErrorType,
	HttpHeaders,
	HttpMethod,
	HttpRequestConfig,
	HttpResponse,
	QueryParams,
	RequestInterceptor,
	ResponseInterceptor,
	ResponseType
} from "./types";

// Schema Types
export type {
	InferOutput,
	StandardSchema,
	StandardSchemaIssue,
	StandardSchemaProps,
	StandardSchemaResult,
	ValidationResult
} from "./types/schema";
export { validateWithSchema } from "./types/schema";

// Path Parameter Types
export type {
	ExtractParamNames,
	ExtractPathParams,
	HasPathParams
} from "./types/path-params";
export { buildPath } from "./types/path-params";

// Result Types
export type { Result } from "./types/result";
export { err, isErr, isOk, ok, unwrapResult } from "./types/result";

// Backward compatibility exports
export type { UniversalClientOptions as SimpleClientOptions } from "./simple";
export { UniversalClient as SimpleClient } from "./simple";