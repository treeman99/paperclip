---
title: On-Prem LLM Lanes
summary: Restrict Paperclip to AWS Bedrock Claude and an in-house open-weight endpoint
---

This deployment supports exactly two LLM lanes and refuses every other provider
at run time:

| Lane | Adapter | Model reaches | Model id shape |
|------|---------|---------------|----------------|
| **A** | `claude_local` | Claude via **AWS Bedrock** | `us.anthropic.claude-*` or `arn:aws:bedrock:*` |
| **B** | `opencode_local` | In-house **open-weight** model behind a URL + bearer token (OpenAI-compatible) | `corp/<model>` |

Enforcement lives in `server/src/adapters/llm-policy.ts`. It is **restricted by
default** — an unset environment means "two lanes only", never "anything goes",
so a future upstream adapter cannot silently open a third lane.

## Where does this get installed?

Paperclip is a **server application**, not a desktop app. It is a Node.js
process plus a PostgreSQL database plus a web UI that people open in a browser.
Agents wake on a schedule and keep running whether or not anyone is looking at
the UI.

Both deployment shapes work, and they are for different purposes:

| | Shared server | Individual PC |
|---|---|---|
| Install | Run as a service (systemd / Windows Service / Docker) | `npx paperclipai onboard --yes` |
| Database | PostgreSQL you operate | Embedded PostgreSQL, auto-managed |
| Who can use it | Everyone on the network, via browser | Only that machine |
| Agents run | 24/7 | Only while the PC is on and the process is running |
| Work happens on | The server's disk and CPU | That PC's disk and CPU |
| Good for | **Actual team use** | Evaluation, a single person's own agents |

Choose the shared server for anything beyond evaluation. Three reasons:

1. **Agents are scheduled.** They wake on heartbeats to pick up work. A laptop
   that sleeps, reboots, or goes home at 6pm means agents stop.
2. **Agents execute real work** — cloning repositories, running builds and
   tests. That consumes the host's disk and CPU, and it happens continuously.
3. **The org chart is shared.** Companies, agents, budgets and issues are one
   dataset. Per-person installs give each person a separate, unshared world.

A reasonable rollout is: one person installs on their PC to evaluate, then the
team moves to a shared server before real work starts. There is no automatic
migration between the two, so decide before accumulating data worth keeping.

## Running on Windows

The build targets Windows, and the codebase has Windows-specific handling
throughout. There are real constraints to plan around.

<Warning>
A POSIX shell must be on `PATH`. Agents run shell commands, and the server
falls back to `sh` on Windows (`server/src/services/workspace-runtime.ts:40`).
Without Git Bash or WSL present, agent runs that execute commands will fail.
</Warning>

**Recommended: WSL2, or Docker Desktop with a Linux container.** Run Paperclip
inside the Linux environment and reach the UI from Windows through the browser.
This avoids every issue below. Native Windows works, but you inherit them.

Before committing to a native install, work through the
[Windows Validation Checklist](/deploy/windows-validation) — its first phase
settles the go/no-go question in about ten minutes.

Native Windows limitations, all verified in code:

| Limitation | Consequence |
|---|---|
| No process groups (`server/src/services/local-service-supervisor.ts:229`, `packages/adapter-utils/src/server-utils.ts:3203`) | Child processes are not spawned detached and process-group liveness always reports false. Orphaned agent processes after a crash need manual cleanup. |
| Process-command matching is skipped (`local-service-supervisor.ts:240`) | The supervisor cannot confirm a recorded PID is still the process it started; stale registry entries are assumed alive. |
| **The bubblewrap sandbox is Linux-only** (`packages/adapter-utils/src/local-process-sandbox.ts`) | `networkScope` and `filesystemScope` cannot be used. There is no application-level way to confine what an agent can reach on the network. |

That last row matters most for this deployment. On Linux, `networkScope:
"allowlist"` confines an agent to specific hosts at the socket level. On
Windows that control does not exist, so **network egress must be enforced at
the firewall or proxy** — it is the only layer left.

If you use the `claude_local` (Bedrock) lane, note also that the Codex
inactivity monitor's `/proc` sampler is Linux-only; this does not affect the
two lanes documented here, but it does rule out `codex_local` on Windows
without a streaming endpoint.

## What is blocked

Blocking happens at run time, not just in the UI. A disallowed adapter is
refused even for agent rows that already exist in the database, and even if the
model is rewritten by a model profile, an import, or a routine after the agent
was created.

Refused adapters: `codex_local`, `cursor`, `cursor_cloud`, `gemini_local`,
`grok_local`, `pi_local`, `hermes_local`, `hermes_gateway`, `openclaw_gateway`,
`process`, `http`, and any adapter type not in the allowlist.

Refused models: a `claude_local` agent set to a direct-API id such as `sonnet`
or `claude-haiku-4-5` (those route to `api.anthropic.com`), and an
`opencode_local` agent whose model does not target the in-house provider.

## Policy configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPERCLIP_LLM_POLICY_MODE` | `restricted` | Set to exactly `open` to disable enforcement. Any other value stays restricted. |
| `PAPERCLIP_LLM_ALLOWED_ADAPTERS` | `claude_local,opencode_local` | Comma-separated adapter allowlist. |
| `PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS` | `corp` | OpenCode provider ids treated as the in-house gateway. |
| `PAPERCLIP_LLM_EXTRA_ALLOWED_MODELS` | (unset) | Comma-separated model ids accepted verbatim, bypassing the shape rules. |

The UI mirrors the adapter allowlist so operators are not offered choices the
server will reject. Override it at build time with
`VITE_PAPERCLIP_LLM_ALLOWED_ADAPTERS` / `VITE_PAPERCLIP_LLM_POLICY_MODE`.

## Lane A — Claude via AWS Bedrock

The `claude_local` adapter already speaks Bedrock. Set these on the Paperclip
server process; they are inherited by the spawned Claude Code CLI.

```bash
CLAUDE_CODE_USE_BEDROCK=1
AWS_REGION=ap-northeast-2
# Credentials via the standard AWS chain: instance role, AWS_PROFILE, or
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.

# Do NOT set these — they would route to the direct Anthropic API:
#   ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL
```

Agent `adapterConfig`:

```jsonc
{
  "model": "us.anthropic.claude-sonnet-4-5-20250929-v2:0"
}
```

When Bedrock env is detected, the adapter serves Bedrock-native model ids from
its own list and reports the biller as `aws_bedrock` rather than `anthropic`.
A bare id such as `sonnet` is rejected by the policy: on Bedrock the CLI would
either fail or fall back to a non-Bedrock route.

## Lane B — in-house open-weight endpoint

Provider injection happens server-side and is written into a per-run OpenCode
config, so the bearer token never has to survive env plumbing into the child.

```bash
# One line — systemd Environment= cannot span newlines.
PAPERCLIP_OPENCODE_PROVIDERS='{"corp":{"npm":"@ai-sdk/openai-compatible","options":{"baseURL":"https://llm.corp.internal/v1","apiKey":"{env:CORP_LLM_KEY}"},"models":{"my-coder-model":{}}}}'

# The bearer token. Must NOT be named PAPERCLIP_* — those are stripped from the
# child environment by sanitizeInheritedPaperclipEnv.
CORP_LLM_KEY='...'

# Required. Without it OpenCode uses a built-in vendor model for session-title
# generation and the run aborts.
PAPERCLIP_OPENCODE_SMALL_MODEL='corp/my-coder-model'

# Recovery-retry lane. Without it, retries use a vendor model id.
PAPERCLIP_OPENCODE_CHEAP_MODEL='corp/my-coder-model'

# Required. Skips the `opencode models` availability probe, which cannot see a
# self-hosted model.
OPENCODE_ALLOW_ALL_MODELS=true

# Puts the model in the picker; adapter CLI discovery cannot find it.
PAPERCLIP_ADAPTER_MODELS='{"opencode_local":[{"id":"corp/my-coder-model","label":"Corp Coder"}]}'
```

Agent `adapterConfig`:

```jsonc
{
  "model": "corp/my-coder-model",
  "dangerouslySkipPermissions": true
}
```

<Warning>
`dangerouslySkipPermissions: false` makes the adapter skip provider injection
entirely — silently, with no error. The run then falls through to whatever
provider OpenCode finds on its own. Keep it `true`.
</Warning>

The provider id (`corp` above) must match `PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS`,
otherwise the policy rejects the model.

## Verifying a run used the right lane

The only observable signal that provider injection worked is in the run's
`commandNotes`:

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/my-coder-model.
```

If those two lines are absent, the run did **not** use the in-house endpoint.
Alerting on their absence is recommended.

## What this policy does not do

This is an application-level control. It does not replace network egress
control, and the following remain the operator's responsibility:

- **Egress firewall.** The vendor agent CLIs are separate processes that hold
  the prompt and repository contents. Block `api.anthropic.com`,
  `api.openai.com`, `chatgpt.com`, `generativelanguage.googleapis.com`,
  `api.x.ai`, and `cursor.com` at the network layer. On Windows this is the
  *only* egress control available — the in-process sandbox is Linux-only.
- **Telemetry.** Set `PAPERCLIP_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`
  (both must be the literal string `1`), and point
  `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL` at an internal sink.
- **Budget enforcement.** No model pricing table exists for a self-hosted
  model, so `cost_cents` stays 0 and budget thresholds never fire. Feed usage
  in through `POST /api/companies/:id/cost-events` from a sidecar, batching
  daily — `costCents` is an integer, so per-run amounts round to zero.
- **Existing agent rows.** Agents created before this policy keep their stored
  `adapterType`. They will now fail at run time rather than silently using a
  vendor model, but auditing and migrating them is a manual step.
