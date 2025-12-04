/**
 * Convert an object to a URL query string
 * @param params - Query parameters object
 * @returns URL-encoded query string
 *
 * Arrays are serialized as multiple query parameters with the same key:
 * { ids: [1, 2, 3] } => "ids=1&ids=2&ids=3"
 */
export function toQuery<Q extends Record<string, unknown>>(params: Q | undefined): string {
	if (!params) {
		return "";
	}

	const searchParams = new URLSearchParams();

	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) {
			continue;
		}

		// Handle arrays by appending each element separately
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item !== undefined && item !== null) {
					searchParams.append(key, String(item));
				}
			}
			continue;
		}

		let stringValue: string;

		if (typeof value === "object") {
			stringValue = JSON.stringify(value);
		} else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
			stringValue = String(value);
		} else {
			// Skip symbols, functions, etc.
			continue;
		}

		searchParams.append(key, stringValue);
	}

	// Format query string with %20 instead of + for spaces, as expected by tests
	return searchParams.toString().replace(/\+/g, "%20");
}