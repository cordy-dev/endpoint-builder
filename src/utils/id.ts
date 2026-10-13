/** A random id for idempotency keys. Uses `crypto.randomUUID` where available (it needs a secure context in browsers). */
export function randomId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const part = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");
	return `${part()}-${part()}-${part()}-${part()}`;
}
