import { describe, expect, it } from "vitest";

import { ApiKeyStrategy } from "../src/auth/ApiKeyStrategy";
import { ExponentialRetryStrategy } from "../src/retry/ExponentialRetryStrategy";
import { createClient, UniversalClient } from "../src/simple";

describe("UniversalClient", () => {
	it("should create a client with default options", () => {
		const client = createClient();
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should create a client with simple options", () => {
		const client = createClient({
			baseUrl: "https://api.example.com",
			timeout: 5000,
			retry: false,
			apiKey: "test-key"
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should create a client with advanced options", () => {
		const client = createClient({
			baseUrl: "https://api.example.com",
			authStrategy: new ApiKeyStrategy("X-API-Key", "test-key"),
			retryStrategy: new ExponentialRetryStrategy(5, 1000, 30000),
			dedupe: false
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should auto-detect Bearer token auth", () => {
		const client = createClient({
			auth: "my-token"
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should support API key auth", () => {
		const client = createClient({
			apiKey: "my-api-key"
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should provide access to advanced RequestBuilder", () => {
		const client = createClient();
		const request = client.request("GET", "/test");
		expect(request).toBeDefined();
		expect(typeof request.timeout).toBe("function");
		expect(typeof request.retry).toBe("function");
		expect(typeof request.headers).toBe("function");
	});

	it("should provide access to underlying HttpClient", () => {
		const client = createClient();
		const httpClient = client.httpClient;
		expect(httpClient).toBeDefined();
		expect(typeof httpClient.get).toBe("function");
	});

	it("should prioritize authStrategy over simple auth options", () => {
		const customAuth = new ApiKeyStrategy("Custom-Header", "custom-value");
		const client = createClient({
			authStrategy: customAuth,
			apiKey: "should-be-ignored",
			auth: "should-also-be-ignored"
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});

	it("should prioritize apiKey over auth string", () => {
		const client = createClient({
			apiKey: "api-key-wins",
			auth: "should-be-ignored"
		});
		expect(client).toBeInstanceOf(UniversalClient);
	});
});
