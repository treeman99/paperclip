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

## 설정 파일 (권장)

환경 변수를 여러 개 넣는 대신 **JSON 파일 하나**로 설정할 수 있습니다.
위치는 `config.json`과 같은 폴더의 `llm-lanes.json`이며,
`PAPERCLIP_LLM_CONFIG_FILE`로 경로를 바꿀 수 있습니다.

```json
{
  "inHouse": {
    "baseUrl": "https://llm.corp.internal/v1",
    "model": "my-coder-model",
    "apiKeyEnv": "CORP_LLM_KEY",
    "providerId": "corp",
    "label": "사내 모델"
  },
  "bedrock": {
    "region": "ap-northeast-2"
  },
  "disableTelemetry": true
}
```

| 항목 | 필수 | 설명 |
|------|------|------|
| `inHouse.baseUrl` | ✅ | 사내 서버 주소. 끝의 `/v1`까지 포함합니다 |
| `inHouse.model` | ✅ | 모델 이름. 앞에 provider를 붙이지 않은 순수 이름 |
| `inHouse.apiKeyEnv` | 둘 중 하나 | 토큰이 담긴 환경 변수 **이름** (권장) |
| `inHouse.apiKey` | 둘 중 하나 | 토큰을 파일에 직접 적는 경우 |
| `inHouse.providerId` | | 모델 앞에 붙는 이름. 기본값 `corp` |
| `inHouse.label` | | 화면에 표시할 이름 |
| `inHouse.npm` | | OpenAI 호환이 아닐 때만 변경. 기본값 `@ai-sdk/openai-compatible` |
| `bedrock.region` | ✅ | Bedrock을 쓸 경우의 리전 |
| `disableTelemetry` | | 기본값 `true` |

`apiKeyEnv`를 쓰면 생성되는 설정에 토큰 대신 `{env:CORP_LLM_KEY}` 참조만 남으므로,
실행 기록에 토큰이 남지 않습니다. 가급적 이쪽을 쓰세요.

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

**레인 A (Bedrock)**

```jsonc
{
  "model": "us.anthropic.claude-sonnet-4-5-20250929-v2:0"
}
```

Bedrock 환경이 감지되면 어댑터가 Bedrock 전용 모델 목록을 제공하고,
비용 청구처를 `anthropic`이 아닌 `aws_bedrock`으로 기록합니다.

**레인 B (사내 모델)**

```jsonc
{
  "model": "corp/my-coder-model",
  "dangerouslySkipPermissions": true
}
```

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
