---
title: Windows Validation Checklist
summary: Verify a Windows host before committing to a native install
---

Run this on the actual Windows machine, as the account the service will run
as. Phase 1 takes ten minutes and settles whether native Windows is viable at
all — do not proceed past a blocking failure.

Scope: the two supported LLM lanes ([On-Prem LLM Lanes](/deploy/on-prem-llm)) —
Lane A `claude_local` on AWS Bedrock, Lane B `opencode_local` on an in-house
OpenAI-compatible endpoint.

## Verdict

Native Windows is the supported target for this deployment. Two defects that
previously had no workaround have been fixed in this fork; the remaining
constraints are configuration or documented limitations.

Command resolution was never the problem people expect: `resolveCommandPath`
walks `PATHEXT` and re-routes `.cmd`/`.bat` through `cmd.exe`
(`packages/adapter-utils/src/server-utils.ts:2236-2252`), so npm shims resolve
correctly.

**Fixed here:**

- **Process-tree termination.** Windows has no process groups, so
  `signalRunningProcess` could only reach the direct child — for a `.cmd`
  wrapper, that is cmd.exe, leaving the real agent alive and holding file locks
  while it kept billing Bedrock or the in-house endpoint. It now kills the tree
  with `taskkill /T` (`/T /F` for SIGKILL). This also fixes the timeout hang:
  the run promise resolves on `close`, which never fired while a surviving
  grandchild held the stdout pipe.
- **Quoting for space-bearing paths.** The cmd.exe wrapper pre-quotes its
  command line, but spawned without `windowsVerbatimArguments` libuv re-escaped
  those quotes and `cmd /s` mis-parsed the result. The flag is now set, so a
  space in `PAPERCLIP_HOME` or the CLI path no longer breaks launches.

<Note>
Both fixes are covered by unit tests
(`packages/adapter-utils/src/windows-process-tree.test.ts`) that simulate
win32, but they have **not yet been exercised on a real Windows host**.
Checks 1-3 and 1-4 below are what confirm them.
</Note>

| | Native Windows | WSL2 | Docker Desktop |
|---|---|---|---|
| Both lanes run | Yes | Yes | Yes |
| Cancel/timeout kills the whole tree | Yes (fixed — verify with 1-3) | Yes | Yes |
| Egress sandbox (`networkScope`) | **Unavailable** | Yes | Yes |
| `isolated_workspace` (git worktree) | Risky — MAX_PATH | Yes | Yes |
| Workspace provision/job commands | Needs `sh` on PATH (ships with Git for Windows) | Yes | Yes |
| Effort | ~1 day | 0.5 day | 1–2 days |

**Remaining native-only limitations**, with no code fix:

- **No application-level egress control.** Bubblewrap is Linux-only
  (`packages/adapter-utils/src/local-process-sandbox.ts`), so `networkScope`
  does not exist. The firewall is the only control — this matters most for
  keeping internal data on the network.
- **`isolated_workspace` / git worktrees risk MAX_PATH.** Use
  `shared_workspace`.
- **Workspace provision/cleanup/job commands and runtime services need a POSIX
  shell** on `PATH`. Installing Git for Windows with Unix tools satisfies this;
  a plain agent run does not need it at all.

## Recommended native configuration

| Setting | Value | Why |
|---|---|---|
| CLI install | Either form works | The `.cmd` wrapper and its quoting are handled |
| `PAPERCLIP_HOME` | `C:\pc` — short | Spaces are now safe; keep it short for MAX_PATH headroom |
| Database | External PostgreSQL via `DATABASE_URL` | Sidesteps embedded-postgres failure modes |
| Workspace mode | `shared_workspace` | Worktrees are what blow MAX_PATH |
| `networkScope` / `filesystemScope` | **Unset** | Lane A fails at spawn with a misleading Bubblewrap error |
| `timeoutSec` | Any value | Safe once check 1-4 passes |
| Service account | Dedicated non-admin local account | Elevated tokens break embedded initdb |
| Node | 22.12+, **x64** | No embedded PostgreSQL binary exists for win32 arm64 |

<Warning>
**Set the data directory ACL before onboarding.** `config.json` (external DB
password), `.env` (agent JWT secret) and `secrets\master.key` — the key that
decrypts your Bedrock credentials and in-house LLM token — are written with
`mode: 0o600` (`cli/src/config/store.ts:114`, `cli/src/config/env.ts:108`,
`server/src/secrets/local-encrypted-provider.ts:74`). **On Windows that is a
no-op**, so those files inherit the parent directory's ACL. Never place the
data root under `C:\ProgramData`, which grants `BUILTIN\Users` read.
</Warning>

```powershell
$Root = 'C:\PaperclipData'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
icacls $Root /inheritance:r /grant:r "Administrators:(OI)(CI)F" /grant:r "$env:USERNAME:(OI)(CI)F"
icacls $Root
```

## Phase 1 — ten-minute go/no-go

All blocking.

### 1-1 Paths and CLI form

```powershell
$paths = @(
  (Get-Command claude   -EA SilentlyContinue | Select-Object -First 1).Source
  (Get-Command opencode -EA SilentlyContinue | Select-Object -First 1).Source
  (npm root -g), $env:USERPROFILE, $env:PAPERCLIP_HOME
)
foreach ($p in $paths) { if ($p) { if ($p -like '* *') { "SPACE!  $p" } else { "ok      $p" } } }
node -p "process.version + ' ' + process.arch"
```

**PASS:** both CLIs resolve; arch is `x64`.

Spaces in these paths used to break launches and no longer do
(`windowsVerbatimArguments` is now set), but a short `PAPERCLIP_HOME` still
buys MAX_PATH headroom. **`arm64` is the blocker here:** there is no embedded
PostgreSQL binary for win32 arm64 — use an external database.

### 1-2 A real agent run completes

Create one agent per lane and give it a trivial task. This is the only check
that exercises the whole chain.

**PASS:** run reaches `succeeded`, and for Lane B the run's `commandNotes`
contains both lines:

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/my-coder-model.
```

**If those two lines are missing,** provider injection was skipped — check that
`dangerouslySkipPermissions` is `true`.

### 1-3 Cancel leaves no orphans — verifies the process-tree fix

Start a long run, note the process tree, cancel it from the UI, then wait a few
seconds and re-check:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe' OR Name='opencode.exe' OR Name='cmd.exe'" |
  Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine | Format-Table -Wrap
```

**PASS:** no agent process from the cancelled run survives.

**If processes survive:** the `taskkill /T` path did not fire. Confirm
`taskkill.exe` is on the service account's `PATH`
(`where.exe taskkill`) and that the account may terminate those processes.
Until resolved you need a periodic cleanup runbook.

### 1-4 Timeout does not hang — verifies the same fix

Set `timeoutSec` to a small value on a throwaway agent and start a run that
exceeds it.

**PASS:** the run transitions to timed-out within roughly `timeoutSec + graceSec`.

**If it hangs:** a grandchild still holds the stdout pipe, meaning the tree kill
did not reach it. Fall back to `timeoutSec: 0` and report it — this is the case
the fix is meant to cover.

## Phase 2 — configuration

### 2-1 Proxy does not capture loopback

If a machine-scope proxy is set, the agent-to-Paperclip API call goes to
`127.0.0.1` — the literal IP, not `localhost`.

```powershell
[Environment]::GetEnvironmentVariable('HTTP_PROXY','Machine')
[Environment]::GetEnvironmentVariable('NO_PROXY','Machine')
```

**PASS:** either no proxy, or `NO_PROXY` includes `127.0.0.1,localhost,::1`.

### 2-2 Corporate CA is trusted by Node

```powershell
[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','Machine')
```

**PASS:** points at a readable PEM. **Node ignores `SSL_CERT_FILE`** — only
`NODE_EXTRA_CA_CERTS` works. Windows programs that use the OS certificate store
are unaffected, but Node is not one of them.

### 2-3 Lane B preflight is disabled

```powershell
[Environment]::GetEnvironmentVariable('OPENCODE_ALLOW_ALL_MODELS','Machine')
```

**PASS:** `true`. Without it, every run performs a network model probe, and its
failure message blames the model rather than the network.

### 2-4 Sandbox scopes are unset

Confirm no agent has `networkScope` or `filesystemScope` in `adapterConfig`.
On Lane A these make every run fail at spawn with a Bubblewrap error that does
not mention Linux.

### 2-5 Workspace mode

Confirm `executionWorkspacePolicy.defaultMode` is `shared_workspace`. Note the
`low_trust_review` trust preset silently upgrades an agent to
`isolated_workspace` (`server/src/services/heartbeat.ts:12104-12107`), which
re-introduces the worktree path-length risk — avoid that preset natively.

If you must use worktrees, verify path headroom:

```powershell
git config --system core.longpaths
```

**PASS:** `true`, plus the registry `LongPathsEnabled` set. Even then, tooling
that predates long-path support (some Node tooling included) still fails.

## Phase 3 — lane specifics

### Lane A — Bedrock

```powershell
aws sts get-caller-identity
aws bedrock-runtime invoke-model --model-id us.anthropic.claude-sonnet-4-5-20250929-v2:0 `
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' `
  --cli-binary-format raw-in-base64-out out.json ; Get-Content out.json
```

**PASS:** identity resolves and the model returns content. Firewall must allow
`bedrock-runtime.<region>.amazonaws.com`. Confirm `CLAUDE_CODE_USE_BEDROCK=1`
and `AWS_REGION` are set machine-scope, and that `ANTHROPIC_API_KEY` /
`ANTHROPIC_BASE_URL` are **not** set.

### Lane B — in-house endpoint

```powershell
$H = @{ Authorization = "Bearer $env:CORP_LLM_KEY" }
Invoke-RestMethod -Uri "$env:LLM_BASE_URL/models" -Headers $H | ConvertTo-Json -Depth 3
```

Then confirm tool calling, which decides whether coding agents work at all:

```powershell
$body = @{
  model = 'my-coder-model'
  messages = @(@{ role = 'user'; content = 'list files in /tmp' })
  tools = @(@{ type = 'function'; function = @{ name = 'bash'
    parameters = @{ type = 'object'; properties = @{ cmd = @{ type = 'string' } }; required = @('cmd') } } })
  tool_choice = 'auto'
} | ConvertTo-Json -Depth 8
(Invoke-RestMethod -Uri "$env:LLM_BASE_URL/chat/completions" -Headers $H -Method Post `
  -ContentType 'application/json' -Body $body).choices[0].message.tool_calls
```

**PASS:** `tool_calls` is non-empty. If empty, the serving stack has no
tool-call parser enabled and no coding agent will function.

## Reading the results

| Result | Meaning |
|---|---|
| 1-1 fails on `arm64` | Use an external database |
| 1-2 fails | Stop and debug; nothing downstream is meaningful |
| **1-3 shows orphans** | The tree-kill fix did not fire. Check `taskkill` on PATH and account privileges; run a cleanup runbook until fixed |
| **1-4 hangs** | Same root cause as 1-3. Fall back to `timeoutSec: 0` and report |
| Phase 2 failures | All configuration — fix and re-run |
| Lane B tool calling empty | Endpoint problem, not Paperclip. Escalate to whoever runs it |

## What this cannot settle

The repository has no Windows CI, so these remain open until observed on the
box over real work:

- **Whether OpenCode honours `XDG_CONFIG_HOME` on Windows.** Lane B's provider
  injection depends on it. Check 1-2's `commandNotes` proves the config was
  written; it does not prove OpenCode read it. Confirm by watching the endpoint
  receive the request.
- **File-locking during worktree cleanup.** Windows cannot delete open files.
  Only cancelling runs mid-build reveals this.
- **CRLF noise in diffs.** Verify by having an agent make one small edit and
  inspecting the resulting diff for whole-file changes.
- **Long-run stability** — handle exhaustion, orphan accumulation over days.
  Run a week of real work before committing.
