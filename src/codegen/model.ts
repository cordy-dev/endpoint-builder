import type { JsonSchema } from "../openapi/json-schema";
import type { HttpMethod } from "../types";

/** The specification cannot be turned into a client (invalid, or uses a feature that is not supported) */
export class SpecError extends Error {
	override readonly name = "SpecError";
}

export type ParameterLocation = "path" | "query" | "header" | "cookie";

export interface ParameterModel {
	name: string;
	in: ParameterLocation;
	required: boolean;
	schema: JsonSchema | boolean;
	description?: string;
	deprecated?: boolean;
	/** OpenAPI serialization style (`form`, `simple`, `deepObject`, `pipeDelimited`, ...), when the spec set one */
	style?: string;
	explode?: boolean;
}

/** Media type (lower-cased, without parameters such as charset) -> schema */
export interface ContentModel {
	[mediaType: string]: { schema?: JsonSchema | boolean };
}

export interface RequestBodyModel {
	required: boolean;
	description?: string;
	content: ContentModel;
}

export interface ResponseModel {
	/** `"200"`, `"2XX"` or `"default"` */
	status: string;
	description?: string;
	content: ContentModel;
	headers: ParameterModel[];
}

/** What an operation takes and returns */
export interface MessageModel {
	summary?: string;
	description?: string;
	deprecated: boolean;
	tags: string[];
	parameters: ParameterModel[];
	requestBody?: RequestBodyModel;
	responses: ResponseModel[];
}

export interface OperationModel extends MessageModel {
	/** As written in the spec; may be missing */
	operationId?: string;
	method: HttpMethod;
	path: string;
}

export interface NormalizedSpec {
	/** Version of the source document */
	version: "2.0" | "3.0" | "3.1";
	info: { title: string; version: string; description?: string };
	/** Absolute or relative base URLs */
	servers: string[];
	/** `components.schemas` (or `definitions`), normalized; refs look like `#/$defs/Name` */
	schemas: { [name: string]: JsonSchema | boolean };
	operations: OperationModel[];
	/** Things that were skipped or approximated */
	warnings: string[];
}
