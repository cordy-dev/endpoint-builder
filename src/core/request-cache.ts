import type { HttpRequestConfig, HttpResponse } from "./types";

/**
 * Request cache for deduplicating identical requests
 */
export class RequestCache {
	private cache = new Map<string, Promise<HttpResponse<any>>>();

	/**
	 * Generate cache key from request config
	 */
	private generateKey(config: HttpRequestConfig): string {
		const { method, url, headers, body } = config;

		// Create a deterministic key from request parameters
		const keyParts = [
			method || "GET",
			url,
			headers ? JSON.stringify(this.sortObject(headers)) : "",
			this.serializeBody(body)
		];

		return keyParts.join("|");
	}

	/**
	 * Sort object keys for deterministic serialization
	 */
	private sortObject(obj: Record<string, any>): Record<string, any> {
		const sorted: Record<string, any> = {};
		Object.keys(obj).sort().forEach(key => {
			sorted[key] = obj[key];
		});
		return sorted;
	}

	/**
	 * Serialize request body for cache key
	 */
	private serializeBody(body: any): string {
		if (!body) return "";

		if (typeof body === "string") {
			return body;
		}

		if (body instanceof FormData) {
			// For FormData, we'll create a simple representation
			const entries: string[] = [];
			// @ts-expect-error - FormData entries() exists in modern browsers
			for (const [key, value] of body.entries()) {
				entries.push(`${key}=${String(value)}`);
			}
			return `FormData:${entries.sort().join("&")}`;
		}

		if (body instanceof URLSearchParams) {
			const entries: string[] = [];
			for (const [key, value] of body.entries()) {
				entries.push(`${key}=${value}`);
			}
			return `URLSearchParams:${entries.sort().join("&")}`;
		}

		// For objects, serialize as JSON
		try {
			return JSON.stringify(body);
		} catch {
			return String(body);
		}
	}

	/**
	 * Get cached request or create new one
	 */
	async get<T>(
		config: HttpRequestConfig,
		executor: () => Promise<HttpResponse<T>>
	): Promise<HttpResponse<T>> {
		const key = this.generateKey(config);

		// Check if request is already in progress
		const existingPromise = this.cache.get(key);
		if (existingPromise) {
			return existingPromise as Promise<HttpResponse<T>>;
		}

		// Start new request
		const promise = executor();
		this.cache.set(key, promise);

		try {
			const result = await promise;
			return result;
		} finally {
			// Remove from cache after completion
			this.cache.delete(key);
		}
	}

	/**
	 * Clear all cached requests
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * Remove specific request from cache
	 */
	delete(config: HttpRequestConfig): void {
		const key = this.generateKey(config);
		this.cache.delete(key);
	}

	/**
	 * Check if request is currently cached
	 */
	has(config: HttpRequestConfig): boolean {
		const key = this.generateKey(config);
		return this.cache.has(key);
	}

	/**
	 * Get number of cached requests
	 */
	size(): number {
		return this.cache.size;
	}
}
