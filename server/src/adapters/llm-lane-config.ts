/**
 * 사내 LLM 레인 설정 파일.
 *
 * 사내 오픈웨이트 모델을 붙이려면 원래 환경 변수를 6~8개 지정해야 하고, 그중
 * 두 개는 손으로 쓰기 까다로운 한 줄짜리 JSON이다. 설치할 PC마다 그걸 넣는 것은
 * 관리가 되지 않는다.
 *
 * 그래서 값 몇 개만 담은 설정 파일 하나를 읽어, 어댑터가 실제로 요구하는 환경
 * 변수들을 서버 부팅 시점에 자동으로 만들어 넣는다. 운영자가 관리하는 것은
 * JSON 파일 하나뿐이다.
 *
 * 파일 위치는 기본적으로 `<config 디렉터리>/llm-lanes.json`이며
 * `PAPERCLIP_LLM_CONFIG_FILE`로 바꿀 수 있다.
 *
 * upstream의 `paperclipConfigSchema`를 건드리지 않고 별도 파일로 둔 이유는,
 * 원본 저장소와 동기화할 때 충돌을 만들지 않기 위해서다.
 *
 * 이미 설정된 환경 변수는 절대 덮어쓰지 않는다. 컨테이너나 systemd에서 내려준
 * 값이 언제나 파일보다 우선이다.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolvePaperclipConfigPath } from "../paths.js";

const DEFAULT_FILE_NAME = "llm-lanes.json";
const DEFAULT_PROVIDER_ID = "corp";
/** 설정 파일에 직접 적은 토큰을 옮겨 담는 전용 변수. */
const GENERATED_API_KEY_ENV_VAR = "PAPERCLIP_INHOUSE_LLM_KEY";

const inHouseLaneSchema = z.object({
  /** 예: https://llm.corp.internal/v1 — 끝에 /v1 까지 포함한다. */
  baseUrl: z.string().min(1),
  /** 모델 이름. 앞에 provider를 붙이지 않은 순수 이름을 적는다. */
  model: z.string().min(1),
  /** 토큰을 파일에 직접 적는 경우. */
  apiKey: z.string().min(1).optional(),
  /** 토큰을 환경 변수/시크릿으로 주입하는 경우 그 변수 이름. apiKey보다 우선. */
  apiKeyEnv: z.string().min(1).optional(),
  /** 모델 앞에 붙는 이름. 기본값 "corp". */
  providerId: z.string().min(1).default(DEFAULT_PROVIDER_ID),
  /** 화면에 보일 이름. */
  label: z.string().min(1).optional(),
  /** OpenAI 호환이 아닌 서버를 쓸 때만 변경한다. */
  npm: z.string().min(1).default("@ai-sdk/openai-compatible"),
});

const bedrockLaneSchema = z.object({
  region: z.string().min(1),
  /** 예: us.anthropic.claude-sonnet-4-5-20250929-v2:0 */
  model: z.string().min(1).optional(),
});

export const llmLaneConfigSchema = z.object({
  inHouse: inHouseLaneSchema.optional(),
  bedrock: bedrockLaneSchema.optional(),
  /** 사용 정보 외부 전송 차단. 기본적으로 차단한다. */
  disableTelemetry: z.boolean().default(true),
});

export type LlmLaneConfig = z.infer<typeof llmLaneConfigSchema>;

export function resolveLlmLaneConfigPath(): string {
  const override = process.env.PAPERCLIP_LLM_CONFIG_FILE?.trim();
  if (override) return path.resolve(override);
  return path.resolve(path.dirname(resolvePaperclipConfigPath()), DEFAULT_FILE_NAME);
}

export function readLlmLaneConfig(filePath = resolveLlmLaneConfigPath()): LlmLaneConfig | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM 설정 파일을 읽지 못했습니다 (${filePath}): ${reason}`);
  }
  const parsed = llmLaneConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`LLM 설정 파일이 올바르지 않습니다 (${filePath}): ${detail}`);
  }
  if (parsed.data.inHouse?.apiKey) warnIfConfigFileIsReadable(filePath);
  return parsed.data;
}

/**
 * 토큰을 파일에 직접 적은 경우에만 권한을 확인한다.
 *
 * Windows에서는 파일 모드가 의미가 없어 상위 폴더의 ACL이 실질적인 통제 수단이므로,
 * 검사 대신 안내만 한다.
 */
function warnIfConfigFileIsReadable(filePath: string) {
  if (process.platform === "win32") {
    console.warn(
      `[paperclip] ${filePath} 에 토큰이 들어 있습니다. 이 파일이 있는 폴더의 접근 권한을 제한했는지 확인하세요.`,
    );
    return;
  }
  try {
    const mode = fs.statSync(filePath).mode & 0o777;
    if (mode & 0o077) {
      console.warn(
        `[paperclip] ${filePath} 권한이 ${mode.toString(8)} 입니다. 토큰이 들어 있으므로 chmod 600 을 권장합니다.`,
      );
    }
  } catch {
    // 권한 확인 실패가 기동을 막을 이유는 없다.
  }
}

/**
 * 설정 파일 내용을 어댑터가 요구하는 환경 변수 모음으로 변환한다.
 * 순수 함수이므로 테스트에서 직접 검증할 수 있다.
 */
export function buildLaneEnv(config: LlmLaneConfig): Record<string, string> {
  const env: Record<string, string> = {};

  if (config.inHouse) {
    const lane = config.inHouse;
    const providerId = lane.providerId;
    const qualifiedModel = `${providerId}/${lane.model}`;
    if (!lane.apiKeyEnv && !lane.apiKey) {
      throw new Error("inHouse 설정에는 apiKey 또는 apiKeyEnv 중 하나가 필요합니다.");
    }
    // 토큰은 항상 {env:VAR} 참조로만 내보낸다. 파일에 직접 적은 경우에도 값을
    // 전용 변수에 옮기고 참조만 남긴다. 그래야 생성된 provider 설정과 실행 기록
    // 어디에도 평문 토큰이 나타나지 않는다.
    //
    // 전용 변수 이름에 PAPERCLIP_ 접두사를 쓴 것은 의도적이다:
    // sanitizeInheritedPaperclipEnv가 자식 프로세스 환경에서 이 접두사를 제거하므로
    // 토큰이 CLI 프로세스로 새어 나가지 않는다. 치환은 서버 프로세스 안에서
    // 일어나므로 동작에는 지장이 없다.
    const apiKeyEnvVar = lane.apiKeyEnv ?? GENERATED_API_KEY_ENV_VAR;
    if (!lane.apiKeyEnv && lane.apiKey) {
      env[apiKeyEnvVar] = lane.apiKey;
    }
    const apiKeyValue = `{env:${apiKeyEnvVar}}`;

    env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify({
      [providerId]: {
        npm: lane.npm,
        ...(lane.label ? { name: lane.label } : {}),
        options: { baseURL: lane.baseUrl, apiKey: apiKeyValue },
        models: { [lane.model]: lane.label ? { name: lane.label } : {} },
      },
    });
    // 보조 모델을 고정하지 않으면 OpenCode가 내장 벤더 모델로 제목을 생성하려다
    // 실행이 중단된다.
    env.PAPERCLIP_OPENCODE_SMALL_MODEL = qualifiedModel;
    env.PAPERCLIP_OPENCODE_CHEAP_MODEL = qualifiedModel;
    // 사내 모델은 `opencode models` 목록에 없으므로 확인 절차를 건너뛴다.
    env.OPENCODE_ALLOW_ALL_MODELS = "true";
    env.PAPERCLIP_ADAPTER_MODELS = JSON.stringify({
      opencode_local: [{ id: qualifiedModel, label: lane.label ?? qualifiedModel }],
    });
    // 정책 모듈이 이 provider 이름을 사내 게이트웨이로 인정하게 한다.
    env.PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS = providerId;
  }

  if (config.bedrock) {
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    env.AWS_REGION = config.bedrock.region;
  }

  if (config.disableTelemetry) {
    // 두 변수 모두 정확히 "1"이어야 한다. "true"는 무시된다.
    env.PAPERCLIP_TELEMETRY_DISABLED = "1";
    env.DO_NOT_TRACK = "1";
  }

  return env;
}

export interface LlmLaneApplyResult {
  filePath: string;
  applied: string[];
  skipped: string[];
}

/**
 * 설정 파일을 읽어 환경 변수에 반영한다. 파일이 없으면 아무것도 하지 않는다.
 * 이미 지정된 환경 변수는 건너뛴다 — 운영 환경에서 내려준 값이 항상 우선이다.
 */
export function applyLlmLaneConfig(
  env: NodeJS.ProcessEnv = process.env,
  filePath = resolveLlmLaneConfigPath(),
): LlmLaneApplyResult | null {
  const config = readLlmLaneConfig(filePath);
  if (!config) return null;

  const laneEnv = buildLaneEnv(config);
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(laneEnv)) {
    if (typeof env[key] === "string" && env[key]!.length > 0) {
      skipped.push(key);
      continue;
    }
    env[key] = value;
    applied.push(key);
  }
  return { filePath, applied, skipped };
}
