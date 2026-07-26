/**
 * Context-window overflow detection.
 *
 * On an on-prem deployment the model's context window is typically far smaller
 * than a vendor cloud model's, so "prompt too long" stops being an exotic error
 * and becomes a routine one. Without recognition it surfaces as a generic
 * `adapter_failed`, which tells the operator nothing and looks identical to a
 * crash.
 *
 * Deliberately NOT wired into `errorFamily`: overflow is deterministic, so
 * retrying the same oversized prompt fails identically every time. Classifying
 * it as `transient_upstream` would burn the bounded retry ladder
 * (2m -> 10m -> 30m -> 2h, see BOUNDED_TRANSIENT_HEARTBEAT_RETRY_DELAYS_MS in
 * services/heartbeat.ts) and hammer the in-house endpoint for ~2h42m before
 * failing anyway. The fix for overflow is a smaller prompt, not another attempt.
 */

export const CONTEXT_OVERFLOW_ERROR_CODE = "context_overflow";

/**
 * Matches the overflow wording of the backends these two lanes use.
 *
 * OpenAI-compatible servers (vLLM, SGLang, TGI, Ollama, llama.cpp) converge on
 * "maximum context length is N tokens" / `context_length_exceeded`. Bedrock
 * raises a ValidationException whose text speaks of input being too long.
 * Kept deliberately broad: a false positive costs a slightly wrong error label,
 * a false negative costs an unexplained dead issue.
 */
const CONTEXT_OVERFLOW_RE =
  /(?:maximum\s+context\s+length|context[_\s-]?length[_\s-]?exceeded|context\s+window\s+(?:exceeded|too\s+small)|reduce\s+the\s+length\s+of\s+the\s+messages|prompt\s+is\s+too\s+long|input\s+is\s+too\s+long|too\s+many\s+input\s+tokens|exceeds\s+the\s+(?:maximum|model)[\s\S]{0,40}token|token\s+limit\s+exceeded|requested\s+\d+\s+tokens[\s\S]{0,80}(?:maximum|limit))/i;

export function isContextOverflowText(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && CONTEXT_OVERFLOW_RE.test(value);
}

/**
 * Actionable guidance appended to the run error. The operator cannot act on
 * "adapter failed"; they can act on knowing which knobs shrink the prompt.
 */
export const CONTEXT_OVERFLOW_GUIDANCE =
  "The prompt exceeded the model's context window. This will not resolve on retry — " +
  "shorten the input instead: trim the issue description and the triggering comment, " +
  "tighten the agent's sessionCompaction limits (maxSessionRuns / maxSessionAgeHours), " +
  "reduce the skills attached to the agent, or serve the model with a larger context window.";

/**
 * Build the run error code for a failed adapter result, upgrading a generic
 * failure to `context_overflow` when the error text says so.
 */
export function classifyRunErrorCode(input: {
  errorCode: string | null | undefined;
  errorMessage: string | null | undefined;
}): string | null {
  if (input.errorCode && input.errorCode !== "adapter_failed") return input.errorCode;
  if (isContextOverflowText(input.errorMessage)) return CONTEXT_OVERFLOW_ERROR_CODE;
  return input.errorCode ?? null;
}
