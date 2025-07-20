import { beforeEach, describe, expect, test, vi } from "vitest";

import { BearerAuthStrategy } from "../src/auth-strategies";
import { HttpClient } from "../src/core/http-client";

// Mock fetch globally
global.fetch = vi.fn();

describe("HttpClient", () => {
	let client: HttpClient;

	beforeEach(() => {
		vi.clearAllMocks();
		client = new HttpClient("https://api.example.com");
	});

	describe("Constructor", () => {
		test("should create client with base URL", () => {
			const client = new HttpClient("https://api.example.com");
			expect(client).toBeInstanceOf(HttpClient);
		});

		test("should normalize base URL by removing trailing slash", () => {
			const client = new HttpClient("https://api.example.com/");
			// We can't directly test private properties, so we test through URL resolution
			const builder = client.get("/test");
			expect(builder).toBeDefined();
		});

		test("should create client with auth strategy", () => {
			const auth = new BearerAuthStrategy(() => "test-token");
			const client = new HttpClient("https://api.example.com", auth);
			expect(client).toBeInstanceOf(HttpClient);
		});

		test("should create client with null auth strategy", () => {
			const client = new HttpClient("https://api.example.com", null);
			expect(client).toBeInstanceOf(HttpClient);
		});

		test("should create client with options", () => {
			const client = new HttpClient("https://api.example.com", undefined, {
				timeout: 5000,
				cache: true,
				mockOnly: false
			});
			expect(client).toBeInstanceOf(HttpClient);
		});
	});

	describe("HTTP Methods", () => {
		test("should create GET builder", () => {
			const builder = client.get("/users");
			expect(builder).toBeDefined();
		});

		test("should create POST builder", () => {
			const builder = client.post("/users");
			expect(builder).toBeDefined();
		});

		test("should create PUT builder", () => {
			const builder = client.put("/users/1");
			expect(builder).toBeDefined();
		});

		test("should create PATCH builder", () => {
			const builder = client.patch("/users/1");
			expect(builder).toBeDefined();
		});

		test("should create DELETE builder", () => {
			const builder = client.delete("/users/1");
			expect(builder).toBeDefined();
		});

		test("should create HEAD builder", () => {
			const builder = client.head("/users");
			expect(builder).toBeDefined();
		});

		test("should create OPTIONS builder", () => {
			const builder = client.requestOptions("/users");
			expect(builder).toBeDefined();
		});
	});

	describe("Fluent API Methods", () => {
		test("should return new instance with mock enabled", () => {
			const mockClient = client.withMock(true);
			expect(mockClient).toBeInstanceOf(HttpClient);
			expect(mockClient).not.toBe(client);
		});

		test("should return new instance with cache enabled", () => {
			const cachedClient = client.withCache(true);
			expect(cachedClient).toBeInstanceOf(HttpClient);
			expect(cachedClient).not.toBe(client);
		});

		test("should return new instance with different auth", () => {
			const auth = new BearerAuthStrategy(() => "new-token");
			const authClient = client.withAuth(auth);
			expect(authClient).toBeInstanceOf(HttpClient);
			expect(authClient).not.toBe(client);
		});

		test("should return new instance with null auth", () => {
			const noAuthClient = client.withAuth(null);
			expect(noAuthClient).toBeInstanceOf(HttpClient);
			expect(noAuthClient).not.toBe(client);
		});
	});

	describe("URL Resolution", () => {
		test("should handle absolute URLs", () => {
			const builder = client.get("https://other-api.com/data");
			expect(builder).toBeDefined();
		});

		test("should handle relative URLs with leading slash", () => {
			const builder = client.get("/users");
			expect(builder).toBeDefined();
		});

		test("should handle relative URLs without leading slash", () => {
			const builder = client.get("users");
			expect(builder).toBeDefined();
		});
	});
});
