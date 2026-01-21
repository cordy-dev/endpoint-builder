import { describe, expect, it } from "vitest";

import { HttpError, NetworkError, ValidationError } from "../src/errors";

describe("Error Classes", () => {
	describe("HttpError", () => {
		it("should create with status and response", () => {
			const error = new HttpError(404, "Not Found", { message: "User not found" });

			expect(error).toBeInstanceOf(Error);
			expect(error).toBeInstanceOf(HttpError);
			expect(error.status).toBe(404);
			expect(error.statusText).toBe("Not Found");
			expect(error.response).toEqual({ message: "User not found" });
			expect(error.message).toBe("HTTP 404: Not Found");
			expect(error.name).toBe("HttpError");
		});

		it("should have type property", () => {
			const error = new HttpError(500, "Internal Server Error");
			expect(error.type).toBe("http");
		});

		it("should work without response", () => {
			const error = new HttpError(503, "Service Unavailable");
			expect(error.response).toBeUndefined();
		});

		it("should include request config when provided", () => {
			const request = { url: "https://api.test.com/users", method: "GET" as const };
			const error = new HttpError(404, "Not Found", null, request);
			expect(error.request).toBe(request);
		});
	});

	describe("ValidationError", () => {
		it("should create with issues and received data", () => {
			const issues = [{ message: "Expected string, got number", path: ["name"] }];
			const received = { name: 123 };
			const error = new ValidationError(issues, received);

			expect(error).toBeInstanceOf(Error);
			expect(error).toBeInstanceOf(ValidationError);
			expect(error.issues).toEqual(issues);
			expect(error.received).toEqual(received);
			expect(error.message).toBe("Validation failed: Expected string, got number");
			expect(error.name).toBe("ValidationError");
			expect(error.type).toBe("validation");
		});

		it("should handle empty issues", () => {
			const error = new ValidationError([], { data: "unknown" });
			expect(error.message).toBe("Validation failed: Unknown validation error");
		});

		it("should handle multiple issues", () => {
			const issues = [
				{ message: "First error", path: ["field1"] },
				{ message: "Second error", path: ["field2"] }
			];
			const error = new ValidationError(issues, {});
			expect(error.message).toBe("Validation failed: First error");
			expect(error.issues).toHaveLength(2);
		});
	});

	describe("NetworkError", () => {
		it("should create with cause", () => {
			const cause = new TypeError("Failed to fetch");
			const error = new NetworkError("Network request failed", cause);

			expect(error).toBeInstanceOf(Error);
			expect(error).toBeInstanceOf(NetworkError);
			expect(error.cause).toBe(cause);
			expect(error.message).toBe("Network request failed");
			expect(error.name).toBe("NetworkError");
			expect(error.type).toBe("network");
		});

		it("should work without cause", () => {
			const error = new NetworkError("Connection timeout");
			expect(error.cause).toBeUndefined();
			expect(error.message).toBe("Connection timeout");
		});
	});
});
