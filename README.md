# 사내 배포 안내 (한국어)

> 이 저장소는 Paperclip 원본을 사내용으로 수정한 버전입니다. 원본 소개는 아래 영문 README에 있습니다.
> **처음 설치하신다면 이 섹션만 순서대로 따라 하시면 됩니다.**

## Paperclip이 뭔가요?

AI 에이전트(코딩 봇)를 **직원처럼 관리하는 웹 앱**입니다. 겉보기엔 할 일 관리 도구인데, 담당자가 사람이 아니라 AI입니다. 이슈를 만들어 배정하면 AI가 알아서 코드를 고치고 결과를 올립니다.

**중요:** 채팅 앱이 아닙니다. AI가 **정해진 주기로 스스로 깨어나** 맡은 일을 합니다. 그래서 컴퓨터가 켜져 있어야 계속 일합니다.

## 원본과 뭐가 다른가요?

| 항목 | 내용 |
|---|---|
| **쓸 수 있는 AI가 2개로 제한됨** | ① AWS Bedrock의 Claude ② 사내 서버에 설치된 오픈웨이트 모델 |
| **나머지는 전부 차단** | OpenAI, Gemini, Cursor 등은 설정해도 **실행 시점에 거부**됩니다. 실수로도 외부에 코드가 나가지 않게 하기 위함입니다 |
| **Windows에서 제대로 동작하도록 수정** | 작업을 취소했을 때 프로세스가 살아남던 문제, 경로에 공백이 있으면 실행이 안 되던 문제를 고쳤습니다 |
| **작은 모델에서도 안 죽게 수정** | 사내 모델은 한 번에 처리할 수 있는 글자 수가 적어서 긴 이슈를 만나면 그냥 실패했습니다. 이제 원인을 알려주고 입력을 알아서 줄입니다 |

---

## 1단계 — 설치 위치

**우선은 개인 PC에 설치해서 쓰는 것을 기준으로 안내합니다.** 혼자 써보거나 소규모로
검증하기에 가장 간단합니다.

```
내 PC 한 대 = Paperclip 서버 + 데이터베이스 + 화면
```

알아두실 점:

- **AI는 내 PC가 켜져 있을 때만 일합니다.** 절전이나 종료 상태에서는 멈춥니다
- **AI가 코드를 내려받고 빌드·테스트를 돌립니다.** 내 PC의 디스크와 CPU를 씁니다
- **내 데이터는 나만 봅니다.** 팀원과 공유되지 않습니다

나중에 팀 전체가 쓰게 되면 공용 서버로 옮기는 편이 낫습니다. 다만 **개인 PC에서 공용
서버로 옮기는 자동 이사 기능이 없으니**, 중요한 데이터가 쌓이기 전에 판단하세요.

## 2단계 — 준비물 챙기기

설치할 컴퓨터에서 PowerShell을 열고 하나씩 확인하세요.

```powershell
# 1) Node.js 22.12 이상, 그리고 x64인지 확인
node -p "process.version + ' ' + process.arch"
```

`v22.12.0 x64` 이상이면 OK. **`arm64`가 나오면** 3단계에서 외부 데이터베이스를 반드시 써야 합니다.

```powershell
# 2) Git 설치 확인 (설치할 때 "Unix tools" 옵션을 켜주세요)
git --version
```

```powershell
# 3) 데이터를 저장할 폴더 만들기 + 권한 잠그기
$Root = 'C:\PaperclipData'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
icacls $Root /inheritance:r /grant:r "Administrators:(OI)(CI)F" /grant:r "$env:USERNAME:(OI)(CI)F"
```

🔴 **3번은 건너뛰지 마세요.** 이 폴더에 **AWS 접속 정보와 사내 AI 토큰을 푸는 열쇠 파일**이 저장됩니다. Windows에서는 프로그램이 파일 권한을 스스로 잠그지 못해서, 폴더 권한을 미리 잠가두지 않으면 그 PC의 다른 사용자가 열어볼 수 있습니다. 특히 `C:\ProgramData` 아래에는 **절대 두지 마세요.**

그리고 미리 받아두셔야 할 정보:

- **사내 AI 서버 주소와 토큰** (담당 부서에서 받으세요) — 4단계에서 파일에 적습니다
- **AWS 계정 정보** (Bedrock을 쓸 경우)
- **PostgreSQL 접속 정보** (권장 — 없으면 내장 DB를 쓰지만 권장하지 않습니다)

---

## 3단계 — 설치하기

```powershell
npx paperclipai onboard --yes --data-dir C:\PaperclipData
```

설치가 끝나면 접속 주소를 알려줍니다. 브라우저로 들어가시면 됩니다.

**데이터베이스는 외부 PostgreSQL을 권장합니다.** 내장 DB는 관리자 권한으로 실행하면 실패하고, arm64에서는 아예 동작하지 않으며, 실패해도 원인을 제대로 알려주지 않습니다.

```powershell
$env:DATABASE_URL = "postgres://사용자:비밀번호@서버주소:5432/paperclip"
```

---

## 4단계 — AI 연결하기

설정은 **파일 하나**로 끝냅니다. 환경 변수를 여러 개 넣을 필요가 없습니다.

`C:\PaperclipData\llm-lanes.json` 파일을 만들고 아래 내용을 넣으세요.
(설치 위치를 바꾸셨다면 `config.json`이 있는 폴더에 두시면 됩니다.)

### 사내 오픈웨이트 모델만 쓰는 경우

```json
{
  "inHouse": {
    "baseUrl": "https://사내주소/v1",
    "model": "모델이름",
    "apiKey": "받으신-토큰"
  }
}
```

**환경 변수를 따로 넣을 필요가 없습니다.** 토큰까지 이 파일 하나에 들어갑니다.

토큰은 파일에만 남고, 실행 기록이나 AI 프로그램에는 전달되지 않도록 처리됩니다.
그래도 **이 파일이 있는 폴더의 권한은 2단계에서 잠가두셔야 합니다.**

> 회사 정책상 토큰을 파일에 두면 안 되는 경우에는 `apiKey` 대신
> `"apiKeyEnv": "CORP_LLM_KEY"` 를 쓰고, 그 이름으로 환경 변수를 지정하세요.

### AWS Bedrock의 Claude만 쓰는 경우

```json
{
  "bedrock": {
    "region": "ap-northeast-2"
  }
}
```

AWS 인증은 평소 쓰시는 방식(프로필, 역할, 액세스 키) 그대로 동작합니다.

### 둘 다 쓰는 경우

```json
{
  "inHouse": {
    "baseUrl": "https://사내주소/v1",
    "model": "모델이름",
    "apiKey": "받으신-토큰"
  },
  "bedrock": {
    "region": "ap-northeast-2"
  }
}
```

### 이 파일이 대신 해주는 일

이 파일 하나를 넣으면 서버가 시작할 때 아래 설정들을 알아서 만들어 넣습니다.
예전처럼 손으로 넣지 않으셔도 됩니다.

| 자동으로 처리되는 것 | 왜 필요한지 |
|---|---|
| 사내 서버 접속 정보 | 어느 주소의 어떤 모델을 쓸지 |
| 보조 모델 지정 | 지정하지 않으면 제목을 만들다가 작업이 중단됩니다 |
| 모델 확인 절차 생략 | 사내 모델은 공개 목록에 없어서 확인에 실패합니다 |
| 화면 모델 목록 등록 | 등록하지 않으면 화면에서 고를 수 없습니다 |
| 사용 정보 외부 전송 차단 | 별도 조치가 필요 없어집니다 |

이미 환경 변수를 넣어두셨다면 **그 값이 우선**입니다. 파일이 기존 설정을 덮어쓰지 않습니다.

### 에이전트를 만들 때

**사내 모델을 쓸 때:**

- 모델: `corp/모델이름` — 반드시 `corp/` 로 시작합니다
- `dangerouslySkipPermissions`: **켜기(true)**

⚠️ `dangerouslySkipPermissions`를 끄면 **아무 오류 메시지 없이** 사내 AI 설정이 통째로 무시됩니다. 반드시 켜두세요.

**Bedrock을 쓸 때:**

모델 이름에 Bedrock 전용 이름을 넣어야 합니다.

- ✅ `us.anthropic.claude-sonnet-4-5-20250929-v2:0`
- ❌ `sonnet`, `claude-haiku-4-5` — 이건 외부 서버로 나가기 때문에 거부됩니다

---

## 5단계 — 잘 되는지 확인하기

에이전트 하나를 만들고 간단한 일을 시켜보세요. 작업이 끝나면 **실행 기록(commandNotes)** 에 아래 두 줄이 있는지 확인하세요.

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/모델이름.
```

**이 두 줄이 없으면 사내 AI를 쓰지 않은 것입니다.** 이게 유일하게 확인 가능한 신호이니 꼭 보세요.

---

## 자주 겪는 문제

| 증상 | 원인과 해결 |
|---|---|
| 작업이 실패하고 `context_overflow` 라고 나옴 | 이슈 내용이 너무 길어서 AI가 한 번에 못 읽습니다. 이슈 설명과 댓글을 줄이거나 에이전트에 붙인 스킬 수를 줄이세요. **다시 시도해도 똑같이 실패**하니 내용을 줄이는 게 유일한 해결입니다 |
| 화면에 사내 모델이 안 보임 | "Refresh models" 버튼을 누르지 마세요. 그래도 안 보이면 `llm-lanes.json` 의 `model` 값에 오타가 없는지 보세요 |
| 에이전트를 만들려는데 어댑터가 몇 개 없음 | 정상입니다. 허용된 2개 외에는 일부러 숨겨져 있습니다 |
| 작업을 취소했는데 뭔가 계속 도는 것 같음 | 작업 관리자에서 `node.exe` / `opencode.exe` 를 확인하세요. 남아 있으면 알려주세요 (수정은 했지만 실제 Windows에서 아직 검증 전입니다) |
| 예산을 설정했는데 작동을 안 함 | 알려진 제약입니다. 사내 모델은 가격표가 없어서 비용이 0원으로 기록되고 예산 제한이 걸리지 않습니다. 사용량은 AI 서버 쪽에서 따로 확인하셔야 합니다 |

---

## 꼭 알아두실 점

**1. 외부 차단은 방화벽으로 하셔야 합니다.**
AI를 실제로 실행하는 건 별도 프로그램이라 앱 안에서 막는 데 한계가 있습니다. 아래 주소들을 네트워크에서 막아주세요.

`api.anthropic.com`, `api.openai.com`, `chatgpt.com`, `generativelanguage.googleapis.com`, `api.x.ai`, `cursor.com`

**2. 사용 정보 외부 전송은 자동으로 차단됩니다.**
4단계의 설정 파일을 넣으면 함께 처리됩니다. 끄고 싶지 않으시면 파일에 `"disableTelemetry": false` 를 넣으세요.

**3. 아직 실제 Windows에서 검증되지 않은 부분이 있습니다.**
Windows 관련 수정은 코드와 테스트로만 확인했습니다. 처음 설치하실 때 [Windows 검증 체크리스트](docs/deploy/windows-validation.md)를 한 번 돌려보시길 권합니다. 10분이면 됩니다.

## 더 자세한 문서

- [사내 AI 연결 상세 가이드](docs/deploy/on-prem-llm.md) — 설정값 전체와 동작 원리
- [Windows 검증 체크리스트](docs/deploy/windows-validation.md) — 설치 전 확인 사항

---
---

<p align="center">
  <img src="doc/assets/banner.jpg" alt="Paperclip is the app people use to manage AI agents for work." width="720" />
</p>

<p align="center">
  <a href="#quickstart"><strong>Quickstart</strong></a> &middot;
  <a href="https://docs.paperclip.ing"><strong>Docs</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>GitHub</strong></a> &middot;
  <a href="https://discord.gg/m4HZY7xNG3"><strong>Discord</strong></a> &middot;
  <a href="https://x.com/papercliping"><strong>Twitter</strong></a> &middot;
  <a href="https://paperclip.ing"><strong>Website</strong></a>
</p>

<p align="center">
  <a href="https://github.com/paperclipai/paperclip/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip/stargazers"><img src="https://img.shields.io/github/stars/paperclipai/paperclip?style=flat" alt="Stars" /></a>
  <a href="https://www.star-history.com/paperclipai/paperclip"><img src="https://api.star-history.com/badge?repo=paperclipai/paperclip" alt="Star History Rank" /></a>
  <a href="https://discord.gg/m4HZY7xNG3"><img src="https://img.shields.io/discord/000000000?label=discord" alt="Discord" /></a>
</p>

<br/>

<div align="center">
  <video src="https://github.com/user-attachments/assets/773bdfb2-6d1e-4e30-8c5f-3487d5b70c8f" width="600" controls></video>
</div>

<br/>

# Paperclip is the app people use to manage AI agents for work.

Open-source orchestration for teams of AI agents.

**If OpenClaw is an _employee_, Paperclip is the _company_.**

Paperclip is a Node.js server and React UI that orchestrates a team of AI agents to run a business. Bring your own agents, assign goals, and track work and costs from one dashboard.

It looks like a task manager. Under the hood: org charts, budgets, governance, goal alignment, and agent coordination.

**Manage business goals, not pull requests.**

|        | Step            | Example                                                            |
| ------ | --------------- | ------------------------------------------------------------------ |
| **01** | Define the goal | _"Build the #1 AI note-taking app to $1M MRR."_                    |
| **02** | Hire the team   | CEO, CTO, engineers, designers, marketers — any bot, any provider. |
| **03** | Approve and run | Review strategy. Set budgets. Hit go. Monitor from the dashboard.  |

<br/>

<div align="center">
<table>
  <tr>
    <td align="center"><strong>Works<br/>with</strong></td>
    <td align="center"><img src="doc/assets/logos/openclaw.svg" width="32" alt="OpenClaw" /><br/><sub>OpenClaw</sub></td>
    <td align="center"><img src="doc/assets/logos/claude.svg" width="32" alt="Claude" /><br/><sub>Claude Code</sub></td>
    <td align="center"><img src="doc/assets/logos/codex.svg" width="32" alt="Codex" /><br/><sub>Codex</sub></td>
    <td align="center"><img src="doc/assets/logos/cursor.svg" width="32" alt="Cursor" /><br/><sub>Cursor</sub></td>
    <td align="center"><img src="doc/assets/logos/bash.svg" width="32" alt="Bash" /><br/><sub>Bash</sub></td>
    <td align="center"><img src="doc/assets/logos/http.svg" width="32" alt="HTTP" /><br/><sub>HTTP</sub></td>
  </tr>
</table>

<em>If it can receive a heartbeat, it's hired.</em>

</div>

<br/>

## Paperclip is right for you if

- ✅ You want to build **autonomous AI companies**
- ✅ You **coordinate many different agents** (OpenClaw, Codex, Claude, Cursor) toward a common goal
- ✅ You have **20 simultaneous Claude Code terminals** open and lose track of what everyone is doing
- ✅ You want agents running **autonomously 24/7**, but still want to audit work and chime in when needed
- ✅ You want to **monitor costs** and enforce budgets
- ✅ You want a process for managing agents that **feels like using a task manager**
- ✅ You want to manage your autonomous businesses **from your phone**

<br/>

## The four pillars

Four things have to work for an organization of AI agents to actually produce: the tasks, the org, the training, and the infrastructure. Paperclip is built around exactly those four pillars.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png">
  <img src="https://raw.githubusercontent.com/paperclipai/paperclip/1ec33ffd8b597f7e36aac3e2fbb4665b8c42dc3c/doc/assets/four-pillars-light.png" alt="The four pillars of Paperclip">
</picture>

| Pillar | Built for | What it covers |
| --- | --- | --- |
| **Agentic Task Manager** — Declare intent. Agents work. You verify the output. | Everyone, daily | Tasks, approvals & review gates · proactive agent coworkers · auditable routines & workflows · verify from diffs, screenshots & tests |
| **Org Chart for Agents** — Roles, permissions & boundaries for humans and agents. | Managers | Mixed human + agent org chart · responsibilities, delegation, specialization · governance: who can do what · scoped secrets & company boundaries |
| **Agent Employee Training** — Design, train & evaluate your AI employees. | Enablers | Skill Studio & shared org-wide skills · evals & saved test runs · active learning loops & quality metrics · performance reviews for agents |
| **Agentic OS** — The infrastructure that makes the work run. | IT & platform | Cross-provider runtime: any model, any agent · sandboxing, integrations & MCP servers · SSO, GRC, RBAC & cost controls · data privacy, internal trace collection, compounding data value |

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🔌 Bring Your Own Agent</h3>
Any agent, any runtime, one org chart. If it can receive a heartbeat, it's hired.
</td>
<td align="center" width="33%">
<h3>🎯 Goal Alignment</h3>
Every task traces back to the company mission. Agents know <em>what</em> to do and <em>why</em>.
</td>
<td align="center" width="33%">
<h3>💓 Heartbeats</h3>
Agents wake on a schedule, check work, and act. Delegation flows up and down the org chart.
</td>
</tr>
<tr>
<td align="center">
<h3>💰 Cost Control</h3>
Monthly budgets per agent. When they hit the limit, they stop. No runaway costs.
</td>
<td align="center">
<h3>🏢 Multi-Company</h3>
One deployment, many companies. Complete data isolation. One control plane for your portfolio.
</td>
<td align="center">
<h3>🎫 Ticket System</h3>
Every conversation traced. Every decision explained. Full tool-call tracing and immutable audit log.
</td>
</tr>
<tr>
<td align="center">
<h3>🛡️ Governance</h3>
Approve hires, override strategy, pause or terminate any agent — at any time.
</td>
<td align="center">
<h3>📊 Org Chart</h3>
Hierarchies, roles, reporting lines. Your agents have a boss, a title, and a job description.
</td>
<td align="center">
<h3>📱 Mobile Ready</h3>
Monitor and manage your autonomous businesses from anywhere.
</td>
</tr>
</table>

<br/>

## Problems Paperclip solves

| Without Paperclip                                                                                                                     | With Paperclip                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ❌ You have 20 Claude Code tabs open and can't track which one does what. On reboot you lose everything.                              | ✅ Tasks are ticket-based, conversations are threaded, sessions persist across reboots.                                                |
| ❌ You manually gather context from several places to remind your bot what you're actually doing.                                     | ✅ Context flows from the task up through the project and company goals — your agent always knows what to do and why.                  |
| ❌ Folders of agent configs are disorganized and you're re-inventing task management, communication, and coordination between agents. | ✅ Paperclip gives you org charts, ticketing, delegation, and governance out of the box — so you run a company, not a pile of scripts. |
| ❌ Runaway loops waste hundreds of dollars of tokens and max your quota before you even know what happened.                           | ✅ Cost tracking surfaces token budgets and throttles agents when they're out. Management prioritizes with budgets.                    |
| ❌ You have recurring jobs (customer support, social, reports) and have to remember to manually kick them off.                        | ✅ Heartbeats handle regular work on a schedule. Management supervises.                                                                |
| ❌ You have an idea, you have to find your repo, fire up Claude Code, keep a tab open, and babysit it.                                | ✅ Add a task in Paperclip. Your coding agent works on it until it's done. Management reviews their work.                              |

<br/>

## Why Paperclip is special

Paperclip handles the hard orchestration details correctly.

|                                   |                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Atomic execution.**             | Task checkout and budget enforcement are atomic, so no double-work and no runaway spend.                      |
| **Persistent agent state.**       | Agents resume the same task context across heartbeats instead of restarting from scratch.                     |
| **Runtime skill injection.**      | Agents can learn Paperclip workflows and project context at runtime, without retraining.                      |
| **Governance with rollback.**     | Approval gates are enforced, config changes are revisioned, and bad changes can be rolled back safely.        |
| **Goal-aware execution.**         | Tasks carry full goal ancestry so agents consistently see the "why," not just a title.                        |
| **Portable company templates.**   | Export/import orgs, agents, and skills with secret scrubbing and collision handling.                          |
| **True multi-company isolation.** | Every entity is company-scoped, so one deployment can run many companies with separate data and audit trails. |

<br/>

## What's Under the Hood

Paperclip is a full control plane, not a wrapper. Before you build any of this yourself, know that it already exists:

```
┌──────────────────────────────────────────────────────────────┐
│                       PAPERCLIP SERVER                       │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │Identity & │  │  Work &   │  │ Heartbeat │  │Governance │  │
│  │  Access   │  │   Tasks   │  │ Execution │  │& Approvals│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Org Chart │  │Workspaces │  │  Plugins  │  │  Budget   │  │
│  │ & Agents  │  │ & Runtime │  │           │  │ & Costs   │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                              │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Routines  │  │ Secrets & │  │ Activity  │  │  Company  │  │
│  │& Schedules│  │  Storage  │  │ & Events  │  │Portability│  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲              ▲
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Claude   │  │   Codex   │  │   CLI     │  │ HTTP/web  │
   │   Code    │  │           │  │  agents   │  │   bots    │
   └───────────┘  └───────────┘  └───────────┘  └───────────┘
```

### The Systems

<table>
<tr>
<td width="50%">

**Identity & Access** — Two deployment modes (trusted local or authenticated), board users, agent API keys, short-lived run JWTs, company memberships, invite flows, and OpenClaw onboarding. Every mutating request is traced to an actor.

</td>
<td width="50%">

**Org Chart & Agents** — Agents have roles, titles, reporting lines, permissions, and budgets. Adapter examples match the diagram: Claude Code, Codex, CLI agents such as Cursor/Gemini/bash, HTTP/webhook bots such as OpenClaw, and external adapter plugins. If it can receive a heartbeat, it's hired.

</td>
</tr>
<tr>
<td>

**Work & Task System** — Issues carry company/project/goal/parent links, atomic checkout with execution locks, first-class blocker dependencies, comments, documents, attachments, work products, labels, and inbox state. No double-work, no lost context.

</td>
<td>

**Heartbeat Execution** — DB-backed wakeup queue with coalescing, budget checks, workspace resolution, secret injection, skill loading, and adapter invocation. Runs produce structured logs, cost events, session state, and audit trails. Recovery handles orphaned runs automatically.

</td>
</tr>
<tr>
<td>

**Workspaces & Runtime** — Project workspaces, isolated execution workspaces (git worktrees, operator branches), and runtime services (dev servers, preview URLs). Agents work in the right directory with the right context every time.

</td>
<td>

**Governance & Approvals** — Board approval workflows, execution policies with review/approval stages, decision tracking, budget hard-stops, agent pause/resume/terminate, and full audit logging. Nothing ships without your sign-off.

</td>
</tr>
<tr>
<td>

**Budget & Cost Control** — Token and cost tracking by company, agent, project, goal, issue, provider, and model. Scoped budget policies with warning thresholds and hard stops. Overspend pauses agents and cancels queued work automatically.

</td>
<td>

**Routines & Schedules** — Recurring tasks with cron, webhook, and API triggers. Concurrency and catch-up policies. Each routine execution creates a tracked issue and wakes the assigned agent — no manual kick-offs needed.

</td>
</tr>
<tr>
<td>

**Plugins** — Instance-wide plugin system with out-of-process workers, capability-gated host services, job scheduling, tool exposure, and UI contributions. Extend Paperclip without forking it.

</td>
<td>

**Secrets & Storage** — Instance and company secrets, encrypted local storage, provider-backed object storage, attachments, and work products. Sensitive values stay out of prompts unless a scoped run explicitly needs them.

</td>
</tr>
<tr>
<td>

**Activity & Events** — Mutating actions, heartbeat state changes, cost events, approvals, comments, and work products are recorded as durable activity so operators can audit what happened and why.

</td>
<td>

**Company Portability** — Export and import entire organizations — agents, skills, projects, routines, and issues — with secret scrubbing and collision handling. One deployment, many companies, complete data isolation.

</td>
</tr>
</table>

<br/>

## What Paperclip is not

|                              |                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Not a chatbot.**           | Agents have jobs, not chat windows.                                                                                  |
| **Not an agent framework.**  | We don't tell you how to build agents. We tell you how to run a company made of them.                                |
| **Not a workflow builder.**  | No drag-and-drop pipelines. Paperclip models companies — with org charts, goals, budgets, and governance.            |
| **Not a prompt manager.**    | Agents bring their own prompts, models, and runtimes. Paperclip manages the organization they work in.               |
| **Not a single-agent tool.** | This is for teams. If you have one agent, you probably don't need Paperclip. If you have twenty — you definitely do. |
| **Not a code review tool.**  | Paperclip orchestrates work, not pull requests. Bring your own review process.                                       |

<br/>

## Quickstart

Open source. Self-hosted. No Paperclip account required.

```bash
npx paperclipai onboard --yes
```

> **Troubleshooting: private npm registry `.npmrc`**
>
> If this fails with an `E404` for `paperclipai` (or similar) and you use a private npm registry (for example GitHub Packages) via a global `~/.npmrc`, `npx` may be resolving `paperclipai` against that private registry instead of the public npm registry.
>
> Diagnostic:
>
> ```bash
> npm config get registry
> ```
>
> Workaround (cross-platform; force the public npm registry for this command):
>
> ```bash
> npx --registry https://registry.npmjs.org paperclipai onboard --yes
> ```

That quickstart path now defaults to trusted local loopback mode for the fastest first run. To start in authenticated/private mode instead, choose a bind preset explicitly:

```bash
npx paperclipai onboard --yes --bind lan
# or:
npx paperclipai onboard --yes --bind tailnet
```

If you already have Paperclip configured, rerunning `onboard` keeps the existing config in place. Use `paperclipai configure` to edit settings.

Or manually:

```bash
git clone https://github.com/paperclipai/paperclip.git
cd paperclip
pnpm install
pnpm dev
```

This starts the API server at `http://localhost:3100`. An embedded PostgreSQL database is created automatically — no setup required.

> **Requirements:** Node.js 20+, pnpm 9.15+

<br/>

## FAQ

**What does a typical setup look like?**
Locally, a single Node.js process manages an embedded Postgres and local file storage. For production, point it at your own Postgres and deploy however you like. Configure projects, agents, and goals — the agents take care of the rest.

If you're a solo entrepreneur you can use Tailscale to access Paperclip on the go. Then later you can deploy to e.g. Vercel when you need it.

**Can I run multiple companies?**
Yes. A single deployment can run an unlimited number of companies with complete data isolation.

**How is Paperclip different from agents like OpenClaw or Claude Code?**
Paperclip _uses_ those agents. It orchestrates them into a company — with org charts, budgets, goals, governance, and accountability.

**Why should I use Paperclip instead of just pointing my OpenClaw to Asana or Trello?**
Agent orchestration has subtleties in how you coordinate who has work checked out, how to maintain sessions, monitoring costs, establishing governance - Paperclip does this for you.

(Bring-your-own-ticket-system is on the Roadmap)

**Do agents run continuously?**
By default, agents run on scheduled heartbeats and event-based triggers (task assignment, @-mentions). You can also hook in continuous agents like OpenClaw. You bring your agent and Paperclip coordinates.

<br/>

## Development

```bash
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm build            # Build all
pnpm typecheck        # Type checking
pnpm test             # Cheap default test run (Vitest only)
pnpm test:watch       # Vitest watch mode
pnpm test:e2e         # Playwright browser suite
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply migrations
```

`pnpm test` does not run Playwright. Browser suites stay separate and are typically run only when working on those flows or in CI.

See [doc/DEVELOPING.md](doc/DEVELOPING.md) for the full development guide.

<br/>

## Roadmap

- ✅ Plugin system (e.g. add a knowledge base, custom tracing, queues, etc)
- ✅ Get OpenClaw / claw-style agent employees
- ✅ companies.sh - import and export entire organizations
- ✅ Easy AGENTS.md configurations
- ✅ Skills Manager, Skill Studio & Skills Store
- ✅ Scheduled Routines
- ✅ Better Budgeting
- ✅ Agent Reviews and Approvals
- ✅ Multiple Human Users
- ✅ Cloud / Sandbox agents (e2b, Cloudflare, Daytona, Modal, Novita, self-hosted Kubernetes)
- ✅ Artifacts & Work Products
- ✅ Deep Planning (planning mode, revisioned plans, plan approvals)
- ✅ Enforced Outcomes (watchdogs, recovery actions, review gates)
- ✅ MCP Tool Gateway & Apps (governed tool access)
- ✅ Secrets Manager with per-agent access
- ✅ Activity log & action attribution
- ✅ Self-healing runs & automatic recovery
- ✅ Agent evals & feedback
- ⚪ Memory / Knowledge
- ⚪ MAXIMIZER MODE
- ⚪ Work Queues
- ⚪ Self-Organization
- ⚪ Automatic Organizational Learning
- ⚪ CEO Chat
- 🟡 Cloud deployments (multi-tenant isolation & local→cloud sync shipped)
- ⚪ Desktop App
- ⚪ Bring-your-own-ticket-system (Asana / Linear / Jira as on-ramps)
- ⚪ Connected Apps (one-click integrations, e.g. Vercel)

This is the short roadmap preview. See the full roadmap in [ROADMAP.md](ROADMAP.md).

<br/>

## Community & Plugins

Find Plugins and more at [awesome-paperclip](https://github.com/gsxdsm/awesome-paperclip)

## Observability

Paperclip ships with opt-in OpenTelemetry auto-instrumentation for the server (traces only). It activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and supports `grpc`, `http/protobuf`, and `http/json` via the standard `OTEL_EXPORTER_OTLP_PROTOCOL` env var. The `@opentelemetry/*` packages are optional peer dependencies — install them only if you want tracing. See [doc/observability.md](doc/observability.md) for install commands and the full env-var reference.

## Telemetry

Paperclip collects anonymous usage telemetry to help us understand how the product is used and improve it. No personal information, issue content, prompts, file paths, or secrets are ever collected. Private repository references are hashed with a per-install salt before being sent.

Contributors changing emitted telemetry events should follow the [Telemetry Data Contract](packages/shared/src/telemetry/README.md).
For proposed first-party events that are not in the generated contract yet, follow [Telemetry Workflow](doc/TELEMETRY_WORKFLOW.md).

Telemetry is **enabled by default** and can be disabled with any of the following:

| Method               | How                                                     |
| -------------------- | ------------------------------------------------------- |
| Environment variable | `PAPERCLIP_TELEMETRY_DISABLED=1`                        |
| Standard convention  | `DO_NOT_TRACK=1`                                        |
| CI environments      | Automatically disabled when `CI=true`                   |
| Config file          | Set `telemetry.enabled: false` in your Paperclip config |

## Contributing

We welcome contributions. See the [contributing guide](CONTRIBUTING.md) for details.

<br/>

## Community

- [Discord](https://discord.gg/m4HZY7xNG3) — Join the community
- [Twitter / X](https://x.com/papercliping) — Follow updates and announcements
- [GitHub Issues](https://github.com/paperclipai/paperclip/issues) — bugs and feature requests
- [GitHub Discussions](https://github.com/paperclipai/paperclip/discussions) — ideas and RFC

<br/>

## License

MIT &copy; 2026 [Paperclip Labs, Inc](https://paperclip.ing)

## Star History

<a href="https://www.star-history.com/?repos=paperclipai%2Fpaperclip&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&theme=dark&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" />
    <img src="https://api.star-history.com/chart?repos=paperclipai/paperclip&type=date&legend=top-left&sealed_token=hFjuwFq41bQD5cevvXVv5cTru2swWRZujwJYKlHhtBh6n0H5-VvJZW2SAlcQKB8u4KxhyEB9JqFg1yccJ8WLv9wPBcoWpWcak4gx0MYTWu_pOs2jKOaDluH7KsLeTKt6DHGkHiN3LsqV9s--MTDQcC6Xl7zV51W0-YezQXo-pVPgoFDFAGf2CY5fiP5Q" alt="Star History Chart" />
  </picture>
</a>

<br/>

---

<p align="center">
  <sub>Open source under MIT. Built for people who want to get work done, not babysit agents.</sub>
</p>
