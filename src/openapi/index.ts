/**
 * Runtime support for clients generated from an OpenAPI / Swagger document
 * (`npx endpoint-builder generate`). The generated file imports everything from here.
 */
export { optional, type QueryStyle, queryStyle, unchecked } from "./helpers";
export { type JsonSchema, type JsonSchemaDefs, jsonSchema, type JsonType, type XmlHints } from "./json-schema";
export { type XmlOptions, xmlBody, xmlResponse } from "./xml";
