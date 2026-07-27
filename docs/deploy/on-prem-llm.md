---
title: 사내 LLM 연결 가이드
summary: AWS Bedrock의 Claude와 사내 오픈웨이트 모델, 두 가지만 허용하도록 구성하기
---

이 배포판은 아래 두 가지 LLM만 지원하며, 나머지는 **실행 시점에 거부**합니다.

| 레인 | 어댑터 | 실제 모델 | 모델 이름 형식 |
|------|--------|-----------|----------------|
| **A** | `claude_local` | AWS **Bedrock**의 Claude | `us.anthropic.claude-*` 또는 `arn:aws:bedrock:*` |
| **B** | `opencode_local` | 사내 서버의 **오픈웨이트** 모델 (URL + 토큰, OpenAI 호환) | `corp/<모델이름>` |

차단 로직은 `server/src/adapters/llm-policy.ts`에 있습니다. **기본값이 제한 모드**이므로,
설정을 안 했다고 해서 다른 모델이 열리지 않습니다. 원본 저장소에 새 어댑터가 추가되어도
자동으로 세 번째 레인이 생기지 않습니다.

## 무엇이 차단되나요

차단은 화면에서 숨기는 수준이 아니라 **실행 시점**에 이루어집니다. 이미 데이터베이스에
저장된 에이전트도 거부되고, 에이전트를 만든 뒤 모델 프로파일·가져오기·루틴이 모델을
바꿔치기해도 실행 직전에 다시 검사합니다.

거부되는 어댑터: `codex_local`, `cursor`, `cursor_cloud`, `gemini_local`, `grok_local`,
`pi_local`, `hermes_local`, `hermes_gateway`, `openclaw_gateway`, `process`, `http`,
그리고 허용 목록에 없는 모든 어댑터.

거부되는 모델: `claude_local` 에이전트에 `sonnet`이나 `claude-haiku-4-5` 같은
직접 API용 이름을 넣은 경우(외부로 나갑니다), 그리고 `opencode_local` 에이전트의 모델이
사내 게이트웨이를 가리키지 않는 경우.

## 화면에서 설정하기 (권장)

**설정 → 인스턴스 설정 → LLM 연결**에서 전부 할 수 있습니다. 이 화면이 아래에서
설명하는 `llm-lanes.json`을 직접 읽고 씁니다. 파일을 손으로 고쳐도 되고, 화면에서
고쳐도 됩니다 — 같은 파일입니다.

화면에서 하는 일은 세 가지입니다.

1. **AWS SSO 프로필 저장과 로그인.** 프로필 이름과 기본 리전을 저장한 뒤 `SSO 로그인`을
   누르면 서버가 `aws sso login`을 실행하고, AWS CLI가 출력하는 인증 주소와 코드를
   화면에 띄웁니다. 브라우저가 자동으로 열리지 않는 PC에서도 그 주소로 들어가면 됩니다.
   현재 세션이 살아 있는지는 `sts get-caller-identity`로 실제 확인합니다.
2. **레인 등록.** Bedrock 레인은 리전과 모델 id를, 사내 모델 레인은 서버 주소·토큰·모델
   이름을 넣습니다. `연결 확인`을 누르면 저장 전에 실제로 붙어 보고, 사내 서버가
   `/v1/models`를 지원하면 **현재 서빙 중인 모델 목록**을 가져와 골라 넣을 수 있습니다.
3. **기본 레인 지정.** 레인을 고르지 않은 에이전트는 기본 레인으로 실행됩니다.

<Note>
AWS CLI v2가 설치되어 있어야 로그인 버튼이 동작합니다. 프로필이 이 PC에 아직 없으면
화면이 `aws configure sso --profile <이름>` 을 안내합니다. Paperclip은 `~/.aws/config`를
직접 고치지 않습니다 — 다른 작업에 쓰는 AWS 설정을 건드리지 않기 위해서입니다.
</Note>

<Warning>
**화면 없는 서버(우분투 systemd 배포)에는 Bedrock 레인을 만들지 마세요.** SSO 로그인
승인은 사람이 브라우저에서 눌러야 하고 세션이 몇 시간마다 만료됩니다. 서버에 붙이면
아무도 보지 않는 시간에 세션이 끊겨 작업이 멈춥니다. 팀 공용 서버는 사내 모델 레인만
쓰는 구성이 안전합니다. 설치 절차는 [사내 배포 안내](https://github.com/treeman99/paperclip#readme)의
경로 B를 보세요.
</Warning>

## 설정 파일

위치는 `config.json`과 같은 폴더의 `llm-lanes.json`이며,
`PAPERCLIP_LLM_CONFIG_FILE`로 경로를 바꿀 수 있습니다.

접속 정보 한 벌을 **레인**이라 부르고 이름을 붙입니다. 에이전트는 레인 이름 하나만
고르므로, 같은 게이트웨이를 여러 에이전트가 써도 토큰이 복제되지 않고 모델이 바뀌면
여기 한 곳만 고치면 됩니다.

```json
{
  "lanes": {
    "사내GPU-A": {
      "kind": "inhouse",
      "baseUrl": "https://llm.corp.internal/v1",
      "model": "my-coder-model",
      "apiKey": "받으신-토큰",
      "providerId": "corp",
      "label": "사내 모델"
    },
    "Bedrock 사내": {
      "kind": "bedrock",
      "region": "ap-northeast-2",
      "model": "us.anthropic.claude-sonnet-4-5-20250929-v2:0"
    }
  },
  "defaultLane": "사내GPU-A",
  "awsSso": { "profile": "corp-sso", "region": "ap-northeast-2" },
  "disableTelemetry": true
}
```

| 항목 | 필수 | 설명 |
|------|------|------|
| `lanes.<이름>.kind` | ✅ | `inhouse` 또는 `bedrock` |
| `lanes.<이름>.baseUrl` | inhouse ✅ | 사내 서버 주소. 끝의 `/v1`까지 포함합니다 |
| `lanes.<이름>.model` | inhouse ✅ | 모델 이름. 앞에 provider를 붙이지 않은 순수 이름 |
| `lanes.<이름>.apiKey` | inhouse, 둘 중 하나 | 토큰을 파일에 직접 적는 경우 |
| `lanes.<이름>.apiKeyEnv` | inhouse, 둘 중 하나 | 토큰을 환경 변수로 넘길 때 그 **변수 이름** |
| `lanes.<이름>.providerId` | | 모델 앞에 붙는 이름. 기본값 `corp`. **사내 레인마다 달라야 합니다** |
| `lanes.<이름>.region` | | Bedrock 리전. 비우면 `awsSso.region` |
| `lanes.<이름>.label` | | 화면에 표시할 이름 |
| `lanes.<이름>.npm` | | OpenAI 호환이 아닐 때만 변경. 기본값 `@ai-sdk/openai-compatible` |
| `defaultLane` | | 레인을 고르지 않은 에이전트가 쓸 레인 |
| `awsSso.profile` | Bedrock 쓰면 ✅ | `aws sso login`에 넘길 프로필 이름 |
| `awsSso.region` | | 레인이 리전을 비웠을 때의 기본값 |
| `disableTelemetry` | | 기본값 `true` |

사내 레인이 여러 개면 `providerId`가 서로 달라야 합니다. 같으면 나중 레인의 토큰이 앞
레인을 덮어써 조용히 엉뚱한 게이트웨이로 붙기 때문에, 저장 시점에 거부합니다.

<Note>
이전 형식(`inHouse`/`bedrock`을 최상위에 둔 파일)도 그대로 읽습니다. 각각 `사내 모델`,
`Bedrock Claude`라는 이름의 레인으로 환산되며, 화면에서 무엇이든 저장하는 순간
`lanes` 형식으로 옮겨집니다.
</Note>

토큰을 `apiKey`로 파일에 직접 적어도 평문이 새어 나가지 않습니다. 값을 전용 변수로
옮기고 생성되는 설정에는 참조만 남기며, 그 변수 이름에 `PAPERCLIP_` 접두사를 써서
자식 프로세스 환경에서 제거되도록 했습니다. 즉 AI 프로그램은 토큰을 보지 못합니다.

다만 **파일 자체는 여전히 평문**이므로 파일이 있는 폴더의 접근 권한을 제한하세요.
토큰을 파일에 두는 것이 정책상 곤란하면 `apiKeyEnv`로 변수 이름만 적으면 됩니다.

### 이 파일이 만들어 주는 것

서버가 시작할 때 아래 환경 변수들을 자동으로 만듭니다.

| 환경 변수 | 없으면 생기는 일 |
|-----------|------------------|
| `PAPERCLIP_OPENCODE_PROVIDERS` | 사내 서버로 연결되지 않습니다 |
| `PAPERCLIP_OPENCODE_SMALL_MODEL` | 제목 생성 단계에서 작업이 중단됩니다 |
| `PAPERCLIP_OPENCODE_CHEAP_MODEL` | 재시도가 외부 벤더 모델로 나갑니다 |
| `OPENCODE_ALLOW_ALL_MODELS` | 모델 확인 절차에서 실행이 실패합니다 |
| `PAPERCLIP_ADAPTER_MODELS` | 화면에서 모델을 고를 수 없습니다 |
| `PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS` | 정책이 사내 모델을 거부합니다 |
| `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION` | Bedrock 대신 외부 API로 나갑니다 |
| `PAPERCLIP_TELEMETRY_DISABLED`, `DO_NOT_TRACK` | 사용 정보가 외부로 전송됩니다 |

**이미 설정된 환경 변수는 덮어쓰지 않습니다.** 컨테이너나 systemd에서 내려준 값이
항상 파일보다 우선입니다.

## 정책 설정

| 환경 변수 | 기본값 | 설명 |
|-----------|--------|------|
| `PAPERCLIP_LLM_POLICY_MODE` | `restricted` | 정확히 `open`일 때만 차단이 풀립니다. 다른 값은 모두 제한 모드 유지 |
| `PAPERCLIP_LLM_ALLOWED_ADAPTERS` | `claude_local,opencode_local` | 허용할 어댑터 목록 |
| `PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS` | `corp` | 사내 게이트웨이로 인정할 provider 이름 |
| `PAPERCLIP_LLM_EXTRA_ALLOWED_MODELS` | (없음) | 형식 검사를 건너뛰고 허용할 모델 이름 |

화면에도 같은 허용 목록이 반영되어, 서버가 거부할 선택지는 아예 보이지 않습니다.
빌드 시 `VITE_PAPERCLIP_LLM_ALLOWED_ADAPTERS` / `VITE_PAPERCLIP_LLM_POLICY_MODE`로
바꿀 수 있습니다.

## 에이전트 설정

에이전트 화면에서 고르는 것은 **LLM 레인 이름 하나**뿐입니다. 어댑터 종류와 모델 id는
레인에서 파생되므로 따로 고를 수 없습니다 — 따로 고르게 두면 레인과 어긋난 조합이
만들어지고, 서버가 저장을 거부합니다.

저장되는 값은 이렇게 생겼습니다.

```jsonc
// 레인 A (Bedrock)
{
  "llmLane": "Bedrock 사내",
  "model": "us.anthropic.claude-sonnet-4-5-20250929-v2:0"
}

// 레인 B (사내 모델)
{
  "llmLane": "사내GPU-A",
  "model": "corp/my-coder-model",
  "dangerouslySkipPermissions": true
}
```

`model`은 저장돼 있지만 **실행 직전에 레인의 현재 값으로 다시 덮어씁니다.** 사내 모델은
그때그때 바뀌므로, 설정 화면에서 모델을 바꾸면 에이전트를 하나씩 다시 저장하지 않아도
다음 실행부터 반영됩니다. Bedrock 레인은 리전과 SSO 프로필도 실행 단위로 맞춥니다.

Bedrock 환경이 감지되면 어댑터가 Bedrock 전용 모델 목록을 제공하고,
비용 청구처를 `anthropic`이 아닌 `aws_bedrock`으로 기록합니다.

<Warning>
`dangerouslySkipPermissions`를 `false`로 두면 어댑터가 사내 서버 설정 주입을
**아무 오류 없이 통째로 건너뜁니다.** 그러면 OpenCode가 자체적으로 찾은 다른 곳으로
연결됩니다. 반드시 `true`로 두세요.
</Warning>

`providerId`(위 예시의 `corp`)는 `PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS`와 일치해야 하며,
설정 파일을 쓰면 자동으로 맞춰집니다.

## 올바른 레인을 썼는지 확인하기

설정 주입이 성공했는지 확인할 수 있는 **유일한 신호**는 실행 기록의 `commandNotes`입니다.

```
Injected 1 custom OpenCode provider(s) from PAPERCLIP_OPENCODE_PROVIDERS: corp.
Pinned OpenCode small_model to corp/my-coder-model.
```

이 두 줄이 없으면 사내 서버를 쓰지 **않은** 것입니다. 없을 때 알림이 오도록
설정해 두시길 권합니다.

## 컨텍스트 초과

사내에 올린 모델은 벤더 클라우드 모델보다 한 번에 처리할 수 있는 양이 훨씬 적어서,
"입력이 너무 김" 오류가 예외가 아니라 일상이 됩니다.

초과된 작업은 이제 `context_overflow` 오류 코드로 실패하며 조치 안내가 함께 기록됩니다.
예전처럼 정체 불명의 `adapter_failed`로 끝나지 않습니다.

**이 오류는 일부러 재시도하지 않습니다.** 같은 입력은 똑같이 실패하므로,
재시도 사다리(2분 → 10분 → 30분 → 2시간)를 태우면 사내 서버를 3시간 가까이 두드린 뒤
결국 실패합니다. 해결책은 입력을 줄이는 것입니다.

효과가 큰 순서:

1. 이슈 설명과 작업을 깨운 댓글을 줄입니다. 두 항목 모두 이제 상한이 적용됩니다
   (각각 12,000자, 4,000자).
2. 에이전트의 `sessionCompaction` 값을 조입니다. `maxSessionRuns`와
   `maxSessionAgeHours`는 데이터베이스 기준이라 항상 동작합니다.
   `maxRawInputTokens`에는 의존하지 마세요 — 서버가 `usage`를 안 주면 영원히 발동하지
   않습니다. 서빙 설정에 `stream_options: {"include_usage": true}`를 켜세요.
3. 에이전트에 붙인 스킬 수를 줄입니다. 스킬 파일 하나가 1만 토큰을 넘기도 합니다.
4. 모델 서빙 시 `--max-model-len`을 키웁니다 (최소 131072, 권장 262144).

## 이 정책이 하지 않는 일

이건 애플리케이션 수준의 통제이며, 네트워크 차단을 대신하지 않습니다.
아래는 운영자의 몫입니다.

- **방화벽 차단.** AI를 실제로 실행하는 것은 별도 프로그램이며, 그 프로그램이 프롬프트와
  저장소 내용을 들고 있습니다. `api.anthropic.com`, `api.openai.com`, `chatgpt.com`,
  `generativelanguage.googleapis.com`, `api.x.ai`, `cursor.com`을 네트워크에서 막으세요.
  Windows에서는 애플리케이션 수준 격리 수단이 없으므로 **이것이 유일한 통제**입니다.
- **예산 강제.** 사내 모델에는 가격표가 없어 비용이 0으로 기록되고 예산 상한이 발동하지
  않습니다. 별도 프로그램이 `POST /api/companies/:id/cost-events`로 사용량을 넣어야 하며,
  `costCents`가 정수라 작업 단위로는 0으로 사라지므로 **하루 단위로 합산**해야 합니다.
- **기존 에이전트 정리.** 이 정책 이전에 만들어진 에이전트는 저장된 어댑터를 그대로
  들고 있습니다. 이제 조용히 외부 모델을 쓰는 대신 실행 시점에 실패하지만,
  찾아서 정리하는 것은 수동 작업입니다.
