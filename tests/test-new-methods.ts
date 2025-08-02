// Quick test to verify new AuthStrategy method names work
import { ApiKeyStrategy, OpaqueTokenStrategy } from "./src/auth/index.js";
import { MemoryStoragePersist } from "./src/storage/index.js";

async function testNewMethodNames() {
	console.log("🧪 Testing new AuthStrategy method names...");

	// Test ApiKeyStrategy
	const apiKeyAuth = new ApiKeyStrategy("X-API-Key", "test-key");
	const mockRequest = new Request("https://api.example.com/test");

	// Test new method
	const headers = await apiKeyAuth.enrichRequest(mockRequest);
	console.log("✅ ApiKeyStrategy.enrichRequest():", headers);

	// Test backward compatibility
	const headersOld = await apiKeyAuth.enrich(mockRequest);
	console.log("✅ ApiKeyStrategy.enrich() (deprecated):", headersOld);

	// Test OpaqueTokenStrategy
	const storage = new MemoryStoragePersist();
	await storage.set("tokens", { access: "test-token", refresh: "refresh-token" });

	const tokenAuth = new OpaqueTokenStrategy(storage, "https://api.example.com/refresh");

	// Test new method
	const tokenHeaders = await tokenAuth.enrichRequest(mockRequest);
	console.log("✅ OpaqueTokenStrategy.enrichRequest():", tokenHeaders);

	// Test error handling method
	const mockResponse = new Response(null, { status: 401 });
	const shouldRetry = await tokenAuth.handleRequestError(mockRequest, mockResponse);
	console.log("✅ OpaqueTokenStrategy.handleRequestError():", shouldRetry);

	console.log("🎉 All new method names working correctly!");
}

testNewMethodNames().catch(console.error);
