---
title: Windows 검증 체크리스트
summary: 설치를 확정하기 전에 실제 Windows 머신에서 확인할 항목
---

실제로 설치할 Windows 머신에서, **서비스가 실행될 계정으로** 진행하세요.
1단계는 10분이면 끝나며, 여기서 막히면 그 뒤는 볼 필요가 없습니다.

대상은 [사내 LLM 연결 가이드](/deploy/on-prem-llm)의 두 레인입니다 —
레인 A는 Bedrock의 Claude, 레인 B는 사내 오픈웨이트 모델.

## 결론

네이티브 Windows가 이 배포판의 대상 환경입니다. 회피 방법이 없던 결함 두 가지는
이 저장소에서 수정했고, 남은 제약은 설정으로 피하거나 감수할 수 있는 것들입니다.

흔히 걱정하는 npm 실행 파일 문제는 원래부터 문제가 아니었습니다.
`resolveCommandPath`가 `PATHEXT`를 훑고 `.cmd`/`.bat`을 `cmd.exe`로 넘겨 처리합니다
(`packages/adapter-utils/src/server-utils.ts:2236-2252`).

**수정한 것:**

- **프로세스 전체 종료.** Windows에는 프로세스 그룹이 없어서 작업을 취소하면 껍데기
  프로세스만 죽고 실제 AI 프로그램은 살아남았습니다. 파일을 붙잡고 있으면서 Bedrock이나
  사내 서버에 계속 요금을 발생시켰습니다. 이제 `taskkill /T`로 하위 프로세스까지
  정리합니다. 이 수정으로 **시간 초과 시 작업이 영원히 멈추던 문제**도 함께 해결됩니다 —
  살아남은 하위 프로세스가 출력 통로를 붙잡고 있으면 종료 신호가 오지 않았기 때문입니다.
- **공백이 있는 경로.** 실행 명령을 만들 때 따옴표가 이중으로 처리되어, 경로에 공백이
  하나라도 있으면 프로그램이 실행되지 않았습니다.

<Note>
두 수정 모두 Windows 환경을 흉내 낸 단위 테스트로 검증했습니다
(`packages/adapter-utils/src/windows-process-tree.test.ts`).
**실제 Windows 머신에서는 아직 확인되지 않았습니다.**
아래 1-3, 1-4 항목이 이것을 실증하는 검사입니다.
</Note>

| | 네이티브 Windows | WSL2 | Docker Desktop |
|---|---|---|---|
| 두 레인 동작 | 가능 | 가능 | 가능 |
| 취소·시간 초과 시 완전 종료 | 가능 (수정됨 — 1-3으로 확인) | 가능 | 가능 |
| 앱 수준 네트워크 격리 | **불가** | 가능 | 가능 |
| 격리 작업공간(git worktree) | 경로 길이 제한 위험 | 가능 | 가능 |
| 작업공간 준비 명령 | `sh` 필요 (Git for Windows에 포함) | 가능 | 가능 |
| 소요 | 약 1일 | 0.5일 | 1~2일 |

**코드로 고칠 수 없는 제약:**

- **앱 수준에서 네트워크를 막을 수 없습니다.** 격리 도구가 Linux 전용이라
  (`packages/adapter-utils/src/local-process-sandbox.ts`) `networkScope` 설정이 없습니다.
  **방화벽이 유일한 통제 수단**이며, 내부 정보 유출 방지에 직결되는 부분입니다.
- **격리 작업공간은 경로 길이 제한(260자) 위험이 있습니다.** 공유 작업공간을 쓰세요.
- **작업공간 준비·정리 명령과 런타임 서비스는 POSIX 셸이 필요합니다.**
  Git for Windows를 Unix tools 옵션과 함께 설치하면 해결됩니다.
  일반적인 AI 작업 실행에는 필요 없습니다.

## 권장 설정

| 항목 | 값 | 이유 |
|---|---|---|
| CLI 설치 형태 | 아무거나 | `.cmd` 처리와 따옴표 문제 모두 해결됨 |
| `PAPERCLIP_HOME` | `C:\pc` — 짧게 | 공백은 이제 안전. 경로 길이 여유 확보용 |
| 데이터베이스 | 외부 PostgreSQL (`DATABASE_URL`) | 내장 DB의 실패 사례를 모두 회피 |
| 작업공간 방식 | 공유 작업공간 | 격리 방식이 경로 길이 제한을 유발 |
| `networkScope` / `filesystemScope` | **설정하지 않음** | 레인 A에서 실행 자체가 실패합니다 |
| `timeoutSec` | 아무 값 | 1-4를 통과하면 안전 |
| 서비스 계정 | 관리자가 아닌 전용 계정 | 관리자 권한이면 내장 DB 초기화가 실패 |
| Node | 22.12 이상, **x64** | win32 arm64용 내장 PostgreSQL이 없음 |

<Warning>
**설치를 시작하기 전에 데이터 폴더 권한을 잠그세요.** `config.json`(외부 DB 비밀번호),
`.env`(에이전트 인증 키), `secrets\master.key`(**Bedrock 자격증명과 사내 토큰을 푸는 열쇠**)가
`mode: 0o600`으로 저장되는데(`cli/src/config/store.ts:114`, `cli/src/config/env.ts:108`,
`server/src/secrets/local-encrypted-provider.ts:74`), **Windows에서 이 설정은 아무 효과가
없습니다.** 파일이 상위 폴더의 권한을 그대로 물려받으므로, `BUILTIN\Users`에 읽기 권한을
주는 `C:\ProgramData` 아래에는 절대 두지 마세요.
</Warning>

```powershell
$Root = 'C:\PaperclipData'
New-Item -ItemType Directory -Force -Path $Root | Out-Null
icacls $Root /inheritance:r /grant:r "Administrators:(OI)(CI)F" /grant:r "$env:USERNAME:(OI)(CI)F"
icacls $Root
```

## 1단계 — 10분 안에 가능 여부 판정

모두 필수 항목입니다.

### 1-1 경로와 실행 파일 확인

```powershell
$paths = @(
  (Get-Command claude   -EA SilentlyContinue | Select-Object -First 1).Source
  (Get-Command opencode -EA SilentlyContinue | Select-Object -First 1).Source
  (npm root -g), $env:USERPROFILE, $env:PAPERCLIP_HOME
)
foreach ($p in $paths) { if ($p) { "$p" } }
node -p "process.version + ' ' + process.arch"
```

**통과 기준:** 두 CLI가 모두 찾아지고, 아키텍처가 `x64`.

경로의 공백은 이제 문제가 되지 않습니다(따옴표 처리 수정됨). 다만 `PAPERCLIP_HOME`은
경로 길이 여유를 위해 짧게 두는 편이 좋습니다. **`arm64`가 나오면** 내장 PostgreSQL을
쓸 수 없으니 외부 데이터베이스를 사용하세요.

### 1-2 실제 작업 한 건 완료

레인별로 에이전트를 하나씩 만들고 간단한 일을 시켜보세요.
전체 과정을 실제로 검증하는 유일한 항목입니다.

**통과 기준:** 작업이 성공으로 끝나고, 레인 B는 실행 기록의 `commandNotes`에
아래 두 줄이 모두 있을 것.

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/my-coder-model.
```

**두 줄이 없다면** 사내 서버 설정이 적용되지 않은 것입니다.
`dangerouslySkipPermissions`가 켜져 있는지 먼저 확인하세요.

### 1-3 취소 후 남는 프로세스 없음 — 수정 사항 실증

오래 걸리는 작업을 시작하고 화면에서 취소한 뒤, 몇 초 기다렸다가 확인하세요.

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='claude.exe' OR Name='opencode.exe' OR Name='cmd.exe'" |
  Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine | Format-Table -Wrap
```

**통과 기준:** 취소한 작업의 프로세스가 하나도 남아 있지 않을 것.

**남아 있다면** 프로세스 정리가 동작하지 않은 것입니다. `where.exe taskkill`로
`taskkill.exe`가 있는지, 그리고 해당 계정에 프로세스를 종료할 권한이 있는지 확인하세요.
해결 전까지는 주기적으로 수동 정리가 필요합니다.

### 1-4 시간 초과 시 멈추지 않음 — 같은 수정 사항 실증

임시 에이전트에 `timeoutSec`을 짧게 주고, 그보다 오래 걸리는 작업을 시켜보세요.

**통과 기준:** `timeoutSec + graceSec` 정도 안에 시간 초과로 종료될 것.

**멈춰 있다면** 하위 프로세스가 출력 통로를 붙잡고 있는 것이며, 프로세스 정리가
거기까지 닿지 않은 것입니다. `timeoutSec: 0`으로 두고 알려주세요.

## 2단계 — 설정 확인

### 2-1 프록시가 내부 통신을 가로채지 않는지

프록시가 설정되어 있다면, AI가 Paperclip에 보내는 요청이 `127.0.0.1`(이름이 아니라 숫자
주소)로 나가므로 예외 처리가 필요합니다.

```powershell
[Environment]::GetEnvironmentVariable('HTTP_PROXY','Machine')
[Environment]::GetEnvironmentVariable('NO_PROXY','Machine')
```

**통과 기준:** 프록시가 없거나, `NO_PROXY`에 `127.0.0.1,localhost,::1`이 들어 있을 것.

### 2-2 사내 인증서 신뢰 설정

```powershell
[Environment]::GetEnvironmentVariable('NODE_EXTRA_CA_CERTS','Machine')
```

**통과 기준:** 읽을 수 있는 인증서 파일을 가리킬 것.
**`SSL_CERT_FILE`은 Node가 무시합니다** — `NODE_EXTRA_CA_CERTS`만 동작합니다.
Windows 인증서 저장소를 쓰는 다른 프로그램은 영향받지 않지만 Node는 그렇지 않습니다.

### 2-3 격리 설정이 꺼져 있는지

에이전트 설정에 `networkScope`나 `filesystemScope`가 없는지 확인하세요.
레인 A에서 이 값이 있으면 모든 작업이 실행 단계에서 실패하는데,
오류 메시지에 Linux 전용이라는 설명이 없어 원인을 찾기 어렵습니다.

### 2-4 작업공간 방식

`executionWorkspacePolicy.defaultMode`가 공유 작업공간인지 확인하세요.
`low_trust_review` 신뢰 설정을 쓰면 자동으로 격리 작업공간으로 바뀌므로
(`server/src/services/heartbeat.ts:12104-12107`) 경로 길이 문제가 되살아납니다.
네이티브 Windows에서는 이 설정을 피하세요.

## 3단계 — 레인별 확인

### 레인 A — Bedrock

```powershell
aws sts get-caller-identity
aws bedrock-runtime invoke-model --model-id us.anthropic.claude-sonnet-4-5-20250929-v2:0 `
  --body '{"anthropic_version":"bedrock-2023-05-31","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' `
  --cli-binary-format raw-in-base64-out out.json ; Get-Content out.json
```

**통과 기준:** 계정 정보가 나오고 모델이 응답할 것.
방화벽에서 `bedrock-runtime.<리전>.amazonaws.com`을 허용해야 합니다.
`ANTHROPIC_API_KEY`와 `ANTHROPIC_BASE_URL`은 **설정되어 있지 않아야** 합니다.

### 레인 B — 사내 서버

```powershell
$H = @{ Authorization = "Bearer $env:CORP_LLM_KEY" }
Invoke-RestMethod -Uri "$env:LLM_BASE_URL/models" -Headers $H | ConvertTo-Json -Depth 3
```

이어서 **도구 호출**을 확인하세요. 코딩 AI가 동작하는지가 여기서 갈립니다.

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

**통과 기준:** `tool_calls`에 내용이 있을 것.
비어 있다면 서버에 도구 호출 기능이 꺼져 있는 것이고, 그 경우 어떤 코딩 AI도 동작하지
않습니다. 서버 담당자에게 문의하세요.

## 결과 해석

| 결과 | 의미 |
|---|---|
| 1-1에서 `arm64` | 외부 데이터베이스를 쓰세요 |
| 1-2 실패 | 여기서 멈추세요. 이후 항목은 의미가 없습니다 |
| **1-3에서 프로세스가 남음** | 프로세스 정리가 동작하지 않은 것. `taskkill` 존재 여부와 계정 권한 확인. 해결 전까지 수동 정리 필요 |
| **1-4에서 멈춤** | 1-3과 같은 원인. `timeoutSec: 0`으로 두고 알려주세요 |
| 2단계 실패 | 모두 설정 문제입니다. 고치고 다시 확인하세요 |
| 레인 B 도구 호출 비어 있음 | Paperclip이 아니라 사내 서버 문제입니다 |

## 이 체크리스트로 확인할 수 없는 것

이 저장소에는 Windows 자동 검사가 없어서, 아래는 실제로 써보기 전에는 알 수 없습니다.

- **OpenCode가 Windows에서 설정 폴더 규약을 따르는지.** 레인 B의 설정 주입이 여기에
  의존합니다. 1-2의 `commandNotes`는 설정 파일이 만들어졌다는 것만 증명하지,
  OpenCode가 그걸 읽었다는 것까지 증명하지는 않습니다. 사내 서버에 요청이 실제로
  도착하는지 확인하세요.
- **작업공간 정리 중의 파일 잠금.** Windows는 열려 있는 파일을 지울 수 없습니다.
  빌드 도중에 작업을 취소해봐야 드러납니다.
- **줄바꿈 문자로 인한 불필요한 변경 표시.** AI에게 작은 수정을 시킨 뒤,
  결과에 파일 전체가 바뀐 것처럼 나오는지 확인하세요.
- **장시간 안정성** — 며칠에 걸친 자원 누수나 프로세스 누적.
  일주일 정도 실제 업무로 돌려본 뒤 확정하세요.
