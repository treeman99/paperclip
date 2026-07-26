/**
 * Client-side mirror of the server's on-prem LLM lane policy.
 *
 * The server is the authority — it refuses disallowed adapters at run time in
 * `server/src/adapters/llm-policy.ts`. This module exists only so the UI does
 * not offer choices that would be rejected on save, and is deliberately a small
 * standalone file to keep fork syncs conflict-free.
 *
 * Override at build time with:
 *   VITE_PAPERCLIP_LLM_ALLOWED_ADAPTERS=claude_local,opencode_local
 *   VITE_PAPERCLIP_LLM_POLICY_MODE=open
 */

const DEFAULT_ALLOWED_ADAPTER_TYPES = ["claude_local", "opencode_local"];

function parseList(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const mode =
  typeof import.meta.env?.VITE_PAPERCLIP_LLM_POLICY_MODE === "string" &&
  import.meta.env.VITE_PAPERCLIP_LLM_POLICY_MODE.trim() === "open"
    ? "open"
    : "restricted";

const configured = parseList(import.meta.env?.VITE_PAPERCLIP_LLM_ALLOWED_ADAPTERS);
const allowedAdapterTypes = new Set(
  configured.length > 0 ? configured : DEFAULT_ALLOWED_ADAPTER_TYPES,
);

/** Whether this deployment permits the adapter type at all. */
export function isAdapterTypeAllowedByPolicy(type: string): boolean {
  if (mode === "open") return true;
  return allowedAdapterTypes.has(type);
}

/** Sorted list of permitted adapter types, for messages and empty states. */
export function listPolicyAllowedAdapterTypes(): string[] {
  return [...allowedAdapterTypes].sort();
}
