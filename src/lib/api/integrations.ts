/**
 * API client for the integrations endpoints.
 *
 * Reads the JWT from localStorage under `a1sid`. (The backend's auth
 * middleware reads the same key on the wire; the legacy cookie path
 * is preserved for the older web/ app, but the new app uses
 * Authorization: Bearer <sid>.)
 *
 * Throws on non-2xx with the structured error envelope from the
 * backend's docs/api-contracts.md (ErrorEnvelope):
 *   { error: { code, message, requestId, ...details } }
 */

import { z } from "zod";

const TOKEN_KEY = "a1sid";
let memoryToken: string | null = null;
let pendingStorageValue: string | null | undefined;

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    const probeKey = `${TOKEN_KEY}:probe`;
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

/** Read the current session id. `null` if not signed in. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  const storage = getBrowserStorage();
  if (!storage) return memoryToken;
  if (pendingStorageValue === null) {
    storage.removeItem(TOKEN_KEY);
    pendingStorageValue = undefined;
  } else if (typeof pendingStorageValue === "string") {
    storage.setItem(TOKEN_KEY, pendingStorageValue);
    pendingStorageValue = undefined;
  }
  return storage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  memoryToken = token;
  pendingStorageValue = token;
  const storage = getBrowserStorage();
  if (storage) {
    storage.setItem(TOKEN_KEY, token);
    pendingStorageValue = undefined;
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  memoryToken = null;
  pendingStorageValue = null;
  const storage = getBrowserStorage();
  if (storage) {
    storage.removeItem(TOKEN_KEY);
    pendingStorageValue = undefined;
  }
}

// -- response schemas (Zod) --
// These mirror the shapes from the backend's docs/api-contracts.md.
// We validate on the client so a schema drift between the backend
// and the UI shows up as a runtime Zod error, not a silent render
// with missing data.

const IntegrationStatus = z.enum(["disconnected", "connecting", "connected", "error"]);
const IntegrationType = z.string().min(1);

export const IntegrationDTO = z.object({
  id: z.string().uuid(),
  type: IntegrationType,
  status: IntegrationStatus,
  config: z.object({}).passthrough(),
  hasCredentials: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  connectedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IntegrationDTO = z.infer<typeof IntegrationDTO>;

const PageOfIntegration = z.object({
  items: z.array(IntegrationDTO),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type PageOfIntegration = z.infer<typeof PageOfIntegration>;

const AdminBootstrap = z.object({
  integrations: PageOfIntegration,
  outboundStatuses: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      blockedLast24h: z.number().int().min(0).optional(),
    }).passthrough(),
  ),
  triggerConfigs: z.record(z.string(), z.array(z.unknown())),
  vaultAudit: z.object({
    tenantId: z.string(),
    totalRowsScanned: z.number().int().min(0),
    totalRowsWithPlaintext: z.number().int().min(0),
    findings: z.array(
      z.object({
        integrationId: z.string(),
        provider: z.string(),
        configFields: z.array(z.string()).default([]),
        oauthFields: z.array(z.string()).default([]),
      }).passthrough(),
    ),
    summary: z.string(),
    note: z.string(),
  }),
  oauthConnectActions: z.record(
    z.string(),
    z.object({ startUrl: z.string().nullable() }),
  ),
  meta: z.object({
    tenantId: z.string(),
    generatedAt: z.string(),
    totalIntegrations: z.number().int().min(0),
  }),
});
export type AdminBootstrap = z.infer<typeof AdminBootstrap>;

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

/**
 * Fetch the admin-bootstrap envelope. Throws on non-2xx.
 */
export async function fetchAdminBootstrap(): Promise<AdminBootstrap> {
  const token = getToken();
  const res = await fetch("/v1/integrations/_admin-bootstrap", {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "application/json",
    },
  });
  if (!res.ok) {
    // Try to extract the structured error envelope.
    const body = await res.json().catch(() => null);
    const parsed = ErrorEnvelope.safeParse(body);
    const code = parsed.success ? parsed.data.error.code : `HTTP_${res.status}`;
    const message = parsed.success ? parsed.data.error.message : res.statusText;
    const requestId = parsed.success ? parsed.data.error.requestId : undefined;
    throw new ApiError({ status: res.status, code, message, requestId });
  }
  const json = await res.json();
  const parsed = AdminBootstrap.safeParse(json);
  if (!parsed.success) {
    // Surface the first Zod issue so the developer sees exactly
    // which field drifted. Without this, the SCHEMA_DRIFT message
    // alone sends the dev back to the docs without a starting
    // point.
    const firstIssue = parsed.error.issues[0];
    const fieldPath = firstIssue?.path?.join(".") ?? "(root)";
    throw new ApiError({
      status: 500,
      code: "SCHEMA_DRIFT",
      message: `Backend response did not match AdminBootstrap at .${fieldPath}: ${firstIssue?.message ?? "unknown"}`,
    });
  }
  return parsed.data;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  constructor(opts: { status: number; code: string; message: string; requestId?: string }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.requestId = opts.requestId;
  }
}
