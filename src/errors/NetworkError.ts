/**
 * Network error for connection failures, timeouts, etc.
 */
export class NetworkError extends Error {
	readonly type = "network" as const;
	override readonly name = "NetworkError";

	constructor(
		message: string,
		public override readonly cause?: Error
	) {
		super(message);
	}
}
