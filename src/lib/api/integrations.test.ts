/**
 * Smoke test for the integrations API client.
 *
 * The real fetch path is exercised against the live backend in
 * dev (the Vite proxy passes through). In unit tests we mock
 * `fetch` to assert the client:
 *   1. Sends an Authorization header when a token is set.
 *   2. Parses the response with the AdminBootstrap Zod schema.
 *   3. Throws an ApiError with the structured envelope on non-2xx.
 *   4. Throws an ApiError with SCHEMA_DRIFT if the response
 *      doesn't match the schema.
 *
 * The Zod schemas are the contract — if the backend adds a
 * field, the parse fails loudly here, not silently in render.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchAdminBootstrap, setToken, clearToken, getToken } from "./integrations";

// Sample provider ids use neutral names (`acme-email`, etc.) — the
// repo's licensing cleanup removed all third-party vendor names
// from code, tests, and fixtures.
const validEnvelope = {
  integrations: {
    items: [
      {
        id: "1443868b-9a18-4f78-ad17-e20648f1f76e",
        type: "acme-email",
        status: "connected",
        config: { "acme-email": { apiKey: "k" } },
        hasCredentials: false,
        lastSyncAt: null,
        lastError: null,
        connectedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  },
  outboundStatuses: {
    "1443868b-9a18-4f78-ad17-e20648f1f76e": { enabled: true, blockedLast24h: 0 },
  },
  triggerConfigs: { "1443868b-9a18-4f78-ad17-e20648f1f76e": [] },
  vaultAudit: {
    tenantId: "11111111-1111-1111-1111-111111111111",
    totalRowsScanned: 1,
    totalRowsWithPlaintext: 0,
    findings: [],
    summary: "All secrets are vault-encrypted.",
    note: "Plaintext rows are accepted for backward compatibility with integrations written before the vault landed.",
  },
  oauthConnectActions: {
    "acme-email": { startUrl: "/v1/integrations/oauth/start?provider=acme-email" },
  },
  meta: {
    tenantId: "11111111-1111-1111-1111-111111111111",
    generatedAt: "2026-01-01T00:00:00.000Z",
    totalIntegrations: 1,
  },
};

function makeMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("fetchAdminBootstrap", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid envelope and returns the typed AdminBootstrap", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(validEnvelope), { status: 200 }),
    );
    const out = await fetchAdminBootstrap();
    expect(out.integrations.items).toHaveLength(1);
    expect(out.integrations.items[0].type).toBe("acme-email");
    expect(out.meta.totalIntegrations).toBe(1);
  });

  it("sends Bearer <sid> when setToken has been called", async () => {
    setToken("sid_test_123");
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(validEnvelope), { status: 200 }),
    );
    await fetchAdminBootstrap();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sid_test_123");
  });

  it("falls back to in-memory token storage when browser localStorage is unavailable", async () => {
    const originalStorage = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      setToken("sid_memory_123");
      expect(getToken()).toBe("sid_memory_123");
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validEnvelope), { status: 200 }),
      );
      await fetchAdminBootstrap();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer sid_memory_123");
      clearToken();
      expect(getToken()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it("keeps fallback token synchronized when browser storage availability changes", async () => {
    const originalStorage = window.localStorage;
    const recoveredStorage = makeMemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      setToken("sid_memory_old");
      expect(getToken()).toBe("sid_memory_old");
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }

    setToken("sid_storage_current");
    expect(getToken()).toBe("sid_storage_current");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: recoveredStorage,
    });
    setToken("sid_storage_current");
    expect(recoveredStorage.getItem("a1sid")).toBe("sid_storage_current");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(getToken()).toBe("sid_storage_current");
      clearToken();
      expect(getToken()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it("clears recovered browser storage after logout while storage is unavailable", async () => {
    const originalStorage = window.localStorage;
    const recoveredStorage = makeMemoryStorage();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: recoveredStorage,
    });
    setToken("sid_persisted_before_clear");
    expect(recoveredStorage.getItem("a1sid")).toBe("sid_persisted_before_clear");

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    clearToken();
    expect(getToken()).toBeNull();

    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: recoveredStorage,
      });
      expect(getToken()).toBeNull();
      expect(recoveredStorage.getItem("a1sid")).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it("does not persist tokens when no browser window is available", async () => {
    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      setToken("sid_server_123");
      expect(getToken()).toBeNull();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validEnvelope), { status: 200 }),
      );
      await fetchAdminBootstrap();
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers.authorization).toBeUndefined();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("throws an ApiError on a 5xx with the structured envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "BACKEND_DOWN", message: "boom", requestId: "req_1" } }),
        { status: 503 },
      ),
    );
    await expect(fetchAdminBootstrap()).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      code: "BACKEND_DOWN",
      message: "boom",
      requestId: "req_1",
    });
  });

  it("throws SCHEMA_DRIFT when the response shape doesn't match", async () => {
    fetchMock.mockResolvedValue(
      // Missing required fields: integrations.meta, vaultAudit.summary, ...
      new Response(JSON.stringify({ integrations: { items: [] } }), { status: 200 }),
    );
    await expect(fetchAdminBootstrap()).rejects.toMatchObject({
      name: "ApiError",
      code: "SCHEMA_DRIFT",
    });
  });
});
