import { vi } from "vitest";

/**
 * Creates a mock for fetch API
 */
export function mockFetch(responseData: any = {}, status = 200, headers = {}) {
	const response = new Response(JSON.stringify(responseData), {
		status,
		headers: new Headers(headers)
	});

	return vi.fn().mockResolvedValue(response);
}

/**
 * Creates a mock for localStorage
 */
export function mockLocalStorage() {
	const store: Record<string, string> = {};

	return {
		getItem: vi.fn((key: string) => store[key] || null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			Object.keys(store).forEach(key => delete store[key]);
		}),
		key: vi.fn((index: number) => Object.keys(store)[index] || null),
		length: Object.keys(store).length
	};
}

/**
 * Mock for Request API
 */
export class MockRequest {
	url: string;
	method: string;
	headers: Headers;

	constructor(url: string, options: RequestInit = {}) {
		this.url = url;
		this.method = options.method || "GET";
		this.headers = new Headers(options.headers || {});
	}
}
