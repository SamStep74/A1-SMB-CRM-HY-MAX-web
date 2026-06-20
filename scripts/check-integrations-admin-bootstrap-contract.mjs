#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = path.join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest");
const expectedTestCount = 8;
const requiredTitles = [
  "parses a valid envelope and returns the typed AdminBootstrap",
  "sends Bearer <sid> when setToken has been called",
  "falls back to in-memory token storage when browser localStorage is unavailable",
  "keeps fallback token synchronized when browser storage availability changes",
  "clears recovered browser storage after logout while storage is unavailable",
  "does not persist tokens when no browser window is available",
  "throws an ApiError on a 5xx with the structured envelope",
  "throws SCHEMA_DRIFT when the response shape doesn't match",
];
const forbiddenSentinelPatterns = [
  { label: "github token", pattern: /\bgithub_pat_[A-Za-z0-9_]+/i },
  { label: "openai-style key", pattern: /\bsk-[A-Za-z0-9_-]{16,}/i },
  { label: "gemini key env", pattern: /\bGEMINI_API_KEY\s*[:=]/i },
  { label: "authorization header", pattern: /\bauthorization\b\s*[:=]/i },
  { label: "bearer token", pattern: /\bbearer\s+[-._~+/=a-z0-9]+/i },
  { label: "cookie", pattern: /\bcookie\b\s*[:=]/i },
  { label: "api key value", pattern: /\bapi[_-]?key\b\s*[:=]\s*[-._~+/=a-z0-9]+/i },
];

function testEnv(env) {
  return {
    CI: "1",
    NODE_ENV: "test",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PATH: env.PATH || "",
    HOME: env.HOME || "",
    TMPDIR: env.TMPDIR || "",
    TMP: env.TMP || "",
    TEMP: env.TEMP || "",
    SystemRoot: env.SystemRoot || "",
    ComSpec: env.ComSpec || "",
    PATHEXT: env.PATHEXT || "",
    GEMINI_API_KEY: "",
    VITE_API_TARGET: "",
    BACKEND_URL: "",
    GITHUB_TOKEN: "",
    GH_TOKEN: "",
  };
}

function findSentinelLeak(...parts) {
  const output = parts.filter(Boolean).join("\n");
  const match = forbiddenSentinelPatterns.find((sentinel) => sentinel.pattern.test(output));
  return match ? match.label : "";
}

function validateVitestOutput(output) {
  if (!/Test Files\s+1 passed\s+\(1\)/.test(output)) return "missing Vitest file pass summary";
  if (!new RegExp(`Tests\\s+${expectedTestCount} passed\\s+\\(${expectedTestCount}\\)`).test(output)) {
    return `missing Vitest ${expectedTestCount}-test pass summary`;
  }
  if (/\bfailed\b/i.test(output)) return "Vitest output contains failures";
  for (const title of requiredTitles) {
    if (!output.includes(title)) return `missing expected test title: ${title}`;
  }
  return "";
}

let result = { status: 1, stdout: "", stderr: "", error: null };
let reportError = "";

try {
  if (!existsSync(vitestBin)) {
    reportError = "missing local Vitest binary; run npm ci first";
  } else {
    result = spawnSync(vitestBin, [
      "run",
      "src/lib/api/integrations.test.ts",
      "--reporter=verbose",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: testEnv(process.env),
      shell: false,
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    reportError = validateVitestOutput(output);
    const leak = findSentinelLeak(output);
    if (leak) reportError = `secret sentinel leaked in eval output: ${leak}`;
  }
} catch (error) {
  reportError = error && error.message ? error.message : String(error);
}

const failed = result.error || result.status !== 0 || reportError;
console.log(`failing_checks=${failed ? 1 : 0}`);

if (reportError) {
  console.error(`report_validation_error=${reportError}`);
}
if (result.error) {
  console.error(result.error.message);
}
process.exitCode = failed ? 1 : 0;
