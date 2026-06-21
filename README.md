# A1-SMB-CRM-HY-MAX-web

Integrations settings UI for the A1 SMB CRM MAX backend. The backend exposes a single endpoint that hydrates the entire settings page (`GET /v1/integrations/_admin-bootstrap`) — this app is its frontend.

## Stack

TanStack Start (React 19) + Tailwind CSS v4 + TanStack Query. i18n via paraglide-js. Toast via sonner. Icons via lucide-react. UI primitives styled after kibo-ui (same as the ANT `web-modern/`).

Mirrors the ANT stack so the same components and patterns work in both apps.

## Status

First cut. The headline deliverable is **the Integrations settings page** that calls `_admin-bootstrap` and renders the result. Mutations (create, update, delete, set-outbound, refresh-now, re-vault) are separate routes that will be added incrementally per the backend's `docs/integrations-admin-ui.md` build spec.

## Local dev

```sh
npm install --legacy-peer-deps
# `--legacy-peer-deps` is required because Vite 6 and TanStack
# Start 1.168.x have a known peer dep conflict that vanilla npm
# refuses. (An `.npmrc` with `legacy-peer-deps=true` makes this
# the default for any npm command in the repo.)
# Set VITE_API_TARGET to your local Fastify dev server.
# Default: http://localhost:4100
VITE_API_TARGET=http://localhost:4100 npm run dev
# App at http://localhost:4173
```

The Vite dev server proxies `/v1/*` to the backend so the browser sees one origin and the auth Bearer token doesn't trip CORS.

## Build

```sh
npm run build
# Produces dist/client (static) + dist/server/server.js (Web Fetch handler)
npm start
# scripts/start.mjs wraps the Web Fetch handler in a Node http listener
# via srvx, binding to PORT (default 4173).
```

## Docker

```sh
docker build -t a1-smb-crm-hy-max-web:latest .
docker compose up -d
# App at http://localhost:4173
```

The compose file in this repo expects a backend service named `backend` on the same `a1-net` network. Override `BACKEND_URL` in the deploy environment.

### Production API proxy

In **dev**, the Vite dev server (`vite.config.ts`) proxies `/v1/*` to `VITE_API_TARGET` (default `http://localhost:4100`).

In **prod**, a Node http middleware in `scripts/start.mjs` (intercepts /v1/* before TanStack Start) forwards the same paths to `BACKEND_URL` (set in the deploy env). The middleware wraps the Web Fetch handler from `dist/server/server.js` and runs `srvx` to bind it to PORT. The browser sees a single origin in both dev and prod.

An external reverse proxy (nginx, caddy) is still recommended for TLS termination and to expose a single host for the two services — the docker-compose in this repo assumes an external proxy.

## Structure

```
src/
├── components/
│   ├── feedback/
│   │   └── Toaster.tsx            # sonner wrapper
│   ├── integrations/
│   │   ├── IntegrationsHeader.tsx  # title + status + last-fetched
│   │   ├── IntegrationsTable.tsx   # one row per IntegrationDTO
│   │   ├── IntegrationsEmpty.tsx   # zero-state
│   │   └── StatusPill.tsx          # status badge
│   └── ui/
│       └── Button.tsx              # kibo-ui-style primitive
├── lib/
│   ├── api/
│   │   ├── integrations.ts         # Zod schemas + fetch client
│   │   └── queryClient.ts          # TanStack Query singleton
│   └── cn.ts                       # twMerge + clsx
├── routes/
│   ├── __root.tsx                  # wraps every page
│   ├── index.tsx                   # redirects to /integrations
│   └── integrations.tsx            # the headline page
└── styles/
    └── globals.css                 # Tailwind v4 entry
scripts/
└── start.mjs                       # Node http listener + /v1/* prod proxy
```

The CI workflow at `.github/workflows/ci.yml` and a
`.dockerignore` (to trim the build context) are at the repo
root.

## Sync with backend

The frontend's `src/lib/api/integrations.ts` Zod schemas mirror the backend's `docs/api-contracts.md` and the admin-bootstrap envelope documented in `docs/integrations-admin-ui.md`. If the backend adds a new field to the envelope, the frontend's Zod parse will fail with `SCHEMA_DRIFT` on the next call — that's the canary.

The drift guard is the design: rather than silently rendering with missing data, the UI loudly refuses to render and asks the operator to update the schema.

## CI

GitHub Actions runs on every push to `main` and on every PR.
The workflow at `.github/workflows/ci.yml` has two jobs:

- `lint-typecheck-test` — `npm ci --legacy-peer-deps`, `npm run
  typecheck`, `npm test`. Cancels in-flight runs of the same
  ref via `concurrency` group.
- `build-image` — `docker build` against the commit SHA. Runs
  after `lint-typecheck-test` succeeds.

`.npmrc` carries `legacy-peer-deps=true`; the workflow also
passes the flag explicitly so a future contributor removing
`.npmrc` does not break the build.

## Karpathy Eval

The integrations admin bootstrap lane keeps the editable surface narrow and
records scalar results through the shared `@a1/ai` runner:

```sh
npm run karpathy:list
npm run karpathy:program -- integrations-admin-bootstrap-contract
npm run karpathy:run -- integrations-admin-bootstrap-contract
```

Use `--allow-harness-dirty` only while bootstrapping reviewed local harness files
before committing them.
