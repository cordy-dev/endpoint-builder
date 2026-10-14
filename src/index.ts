// Client
export type { Api, BodyOptions, ClientOptions, ErrorsOf, RequestOptions } from "./core/client";
export { Client, ClientBuilder, createApi, createClient } from "./core/client";
export type {
	ClientConfig,
	Hooks,
	OnErrorHook,
	OnRequestHook,
	OnResponseHook,
	OnRetryHook,
	OnSuccessHook,
	Unwrap,
} from "./core/config";
export type { ErrorSchemas, IdempotentOptions, InferErrors, MergeErrors } from "./core/request";
export { RequestBuilder } from "./core/request";

// Contracts
export type { BoundContract, Contract, EndpointData, EndpointErrors, EndpointFn, EndpointInput } from "./contract";
export type { EndpointSpec } from "./contract";
export { defineContract, Endpoint, endpoint } from "./contract";

// Streams
export type { NdjsonOptions, SseMessage, SseOptions } from "./stream";
export { EventStream } from "./stream";

// Auth
export type { ApiKeyOptions, Credential, RefreshableOptions } from "./auth";
export { apiKey, basic, bearer, refreshable } from "./auth";
export type { AuthStrategy } from "./auth/types";

// Retry
export type { Backoff, RetryInput, RetryOptions, RetryState } from "./retry";
export { computeDelay, IDEMPOTENT_METHODS, RETRY_STATUS_CODES } from "./retry";

// Middleware
export type { Middleware, Next } from "./middleware";
export { compose } from "./middleware";
export type { RateLimit } from "./middleware/limit";

// Errors
export type { ApiError, DeclaredHttpError, ErrorMap, ErrorRequest, ErrorType, ValidationStage } from "./errors";
export {
	AbortError,
	EndpointError,
	HttpError,
	isHttpError,
	NetworkError,
	ParseError,
	SizeLimitError,
	TimeoutError,
	ValidationError,
} from "./errors";

// Result
export type { Result } from "./result";
export { err, isErr, isOk, mapError, mapResult, ok, unwrap, unwrapOr } from "./result";

// Schema
export type { InferInput, InferOutput, Issue, Schema, StandardSchemaV1, ValidationOutcome } from "./schema";
export { isStandardSchema, schema, validate } from "./schema";

// Utilities
export type {
	FetchLike,
	HeadersInput,
	HttpMethod,
	HttpResponse,
	QueryInput,
	QueryObject,
	QueryValue,
	RequestContext,
	RequestInitExtras,
	ResponseType,
} from "./types";
export type { FormInput, FormValue } from "./utils/body";
export type { HasParams, HasRequiredParams, ParamNames, PathParams, PathParamValue } from "./utils/path";
export { buildPath, path } from "./utils/path";
export type { ArrayFormat, QuerySerializer, QuerySerializerOptions } from "./utils/query";
export { createQuerySerializer } from "./utils/query";
