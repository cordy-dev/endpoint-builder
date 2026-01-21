import { describe, expect,expectTypeOf, it } from "vitest";

import type { ExtractPathParams, HasPathParams } from "../src/types/path-params";
import { buildPath } from "../src/types/path-params";

describe("Path Parameter Types", () => {
	describe("ExtractPathParams", () => {
		it("should extract single param", () => {
			type Params = ExtractPathParams<"/users/:id">
			expectTypeOf<Params>().toEqualTypeOf<{ id: string | number }>();
		});

		it("should extract multiple params", () => {
			type Params = ExtractPathParams<"/users/:userId/posts/:postId">
			expectTypeOf<Params>().toEqualTypeOf<{ userId: string | number; postId: string | number }>();
		});

		it("should return empty object for no params", () => {
			type Params = ExtractPathParams<"/users">
			expectTypeOf<Params>().toEqualTypeOf<Record<string, never>>();
		});

		it("should handle params at the end", () => {
			type Params = ExtractPathParams<"/api/v1/items/:itemId">
			expectTypeOf<Params>().toEqualTypeOf<{ itemId: string | number }>();
		});

		it("should handle three params", () => {
			type Params = ExtractPathParams<"/orgs/:orgId/teams/:teamId/members/:memberId">
			expectTypeOf<Params>().toEqualTypeOf<{
				orgId: string | number
				teamId: string | number
				memberId: string | number
			}>();
		});
	});

	describe("HasPathParams", () => {
		it("should return true for path with params", () => {
			type Result = HasPathParams<"/users/:id">
			expectTypeOf<Result>().toEqualTypeOf<true>();
		});

		it("should return false for path without params", () => {
			type Result = HasPathParams<"/users">
			expectTypeOf<Result>().toEqualTypeOf<false>();
		});
	});

	describe("buildPath", () => {
		it("should replace single param", () => {
			const result = buildPath("/users/:id", { id: 1 });
			expect(result).toBe("/users/1");
		});

		it("should replace multiple params", () => {
			const result = buildPath("/users/:userId/posts/:postId", {
				userId: 1,
				postId: 5
			});
			expect(result).toBe("/users/1/posts/5");
		});

		it("should handle string params", () => {
			const result = buildPath("/orgs/:orgId/teams/:teamId", {
				orgId: "acme",
				teamId: "dev"
			});
			expect(result).toBe("/orgs/acme/teams/dev");
		});
	});
});
