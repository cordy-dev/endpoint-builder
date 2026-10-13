/**
 * Standard Schema v1 interface (inlined to stay dependency-free).
 * Implemented by zod (>=3.24), valibot (>=1.0), arktype (>=2.0), effect/schema, yup (>=1.7) and others.
 * @see https://github.com/standard-schema/standard-schema
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace StandardSchemaV1 {
	export interface Props<Input = unknown, Output = Input> {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown, options?: Options) => Result<Output> | Promise<Result<Output>>;
		readonly types?: Types<Input, Output> | undefined;
	}

	export interface Options {
		readonly libraryOptions?: Record<string, unknown> | undefined;
	}

	export type Result<Output> = SuccessResult<Output> | FailureResult;

	export interface SuccessResult<Output> {
		readonly value: Output;
		readonly issues?: undefined;
	}

	export interface FailureResult {
		readonly issues: ReadonlyArray<Issue>;
	}

	export interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	export interface PathSegment {
		readonly key: PropertyKey;
	}

	export interface Types<Input = unknown, Output = Input> {
		readonly input: Input;
		readonly output: Output;
	}
}
