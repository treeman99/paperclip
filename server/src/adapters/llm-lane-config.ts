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
 * ## 레인(lane)
 *
 * 접속 정보 한 벌을 "레인"이라 부르고 이름을 붙여 `lanes`에 모아 둔다. 에이전트는
 * 레인 이름 하나만 고르며, URL·토큰을 직접 갖지 않는다. 같은 게이트웨이를 여러
 * 에이전트가 쓸 때 토큰이 복제되지 않고, 토큰이 바뀌면 한 곳만 고치면 된다.
 *
 *   {
 *     "lanes": {
 *       "사내GPU-A": { "kind": "inhouse", "baseUrl": "...", "apiKey": "...", "model": "..." },
 *       "Bedrock":   { "kind": "bedrock", "region": "us-west-2", "model": "us.anthropic...." }
 *     },
 *     "defaultLane": "사내GPU-A",
 *     "awsSso": { "profile": "corp-sso", "region": "us-west-2" }
 *   }
 *
 * 예전 형식(`inHouse`/`bedrock`을 최상위에 둔 파일)도 그대로 읽는다. 이미 배포된
 * 설치본을 깨뜨리지 않기 위해서이며, 읽는 시점에 레인 하나로 환산된다.
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

/** 예전 형식을 환산할 때 붙는 레인 이름. 화면에도 이 이름으로 보인다. */
export const LEGACY_INHOUSE_LANE_NAME = "사내 모델";
export const LEGACY_BEDROCK_LANE_NAME = "Bedrock Claude";

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

/** `lanes` 안에 들어가는 사내 모델 레인. 예전 형식과 필드가 같고 kind만 더 붙는다. */
const inHouseLaneEntrySchema = inHouseLaneSchema.extend({
  kind: z.literal("inhouse"),
});

/**
 * `lanes` 안에 들어가는 Bedrock 레인.
 *
 * region은 비워 둘 수 있다 — 비우면 `awsSso.region`을 쓴다. SSO 프로필은 PC 하나에
 * 하나라는 전제라 보통 `awsSso.profile`을 그대로 쓰지만, 계정을 나눠 쓰는 설치본을
 * 위해 레인별 덮어쓰기를 남겨 둔다.
 */
const bedrockLaneEntrySchema = z.object({
  kind: z.literal("bedrock"),
  region: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
});

export const llmLaneEntrySchema = z.discriminatedUnion("kind", [
  inHouseLaneEntrySchema,
  bedrockLaneEntrySchema,
]);

export type LlmLaneEntry = z.infer<typeof llmLaneEntrySchema>;
export type InHouseLaneEntry = z.infer<typeof inHouseLaneEntrySchema>;
export type BedrockLaneEntry = z.infer<typeof bedrockLaneEntrySchema>;

/**
 * AWS SSO 로그인 정보. 화면의 로그인 버튼이 이 프로필로 `aws sso login`을 실행한다.
 * startUrl/accountId/roleName이 모두 있으면 프로필이 없을 때 서버가 만들어 줄 수 있다.
 */
const awsSsoSchema = z.object({
  profile: z.string().min(1),
  region: z.string().min(1).optional(),
  startUrl: z.string().min(1).optional(),
  ssoRegion: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  roleName: z.string().min(1).optional(),
});

export type AwsSsoConfig = z.infer<typeof awsSsoSchema>;

export const llmLaneConfigSchema = z.object({
  /** 이름 붙인 접속 프리셋. 에이전트는 이 이름 하나만 고른다. */
  lanes: z.record(z.string().min(1), llmLaneEntrySchema).optional(),
  /** 에이전트가 레인을 고르지 않았을 때 쓰는 레인 이름. */
  defaultLane: z.string().min(1).optional(),
  awsSso: awsSsoSchema.optional(),
  /** 예전 형식. 읽기 전용 호환을 위해 남겨 둔다. */
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
  const holdsInlineToken =
    !!parsed.data.inHouse?.apiKey ||
    Object.values(parsed.data.lanes ?? {}).some(
      (lane) => lane.kind === "inhouse" && !!lane.apiKey,
    );
  if (holdsInlineToken) warnIfConfigFileIsReadable(filePath);
  return parsed.data;
}

/**
 * 설정 파일을 덮어쓴다. 토큰이 들어가므로 새로 만들 때는 0600으로 만든다.
 *
 * 같은 디렉터리에 임시 파일을 쓴 뒤 rename 하는 이유는, 쓰는 도중 서버가 죽어도
 * 반쯤 쓰인 JSON이 남지 않게 하기 위해서다. rename은 같은 파일시스템 안에서만
 * 원자적이라 임시 파일도 같은 디렉터리에 만든다.
 */
export function writeLlmLaneConfig(
  config: LlmLaneConfig,
  filePath = resolveLlmLaneConfigPath(),
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  // 이미 있던 파일은 rename이 권한을 유지하지 않으므로 다시 좁혀 준다.
  // Windows에서는 파일 모드가 의미가 없어 건너뛴다(상위 폴더 ACL이 통제 수단).
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // 권한 조정 실패가 저장 자체를 막을 이유는 없다. 읽을 때 경고가 다시 뜬다.
    }
  }
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

export interface NamedLane {
  name: string;
  lane: LlmLaneEntry;
}

/**
 * 설정 파일에 들어 있는 레인을 이름과 함께 모두 돌려준다.
 *
 * `lanes`가 먼저 오고, 예전 형식(`inHouse`/`bedrock`)은 같은 이름의 레인이 없을
 * 때만 뒤에 붙는다. 같은 이름이 있으면 새 형식이 이긴다 — 마이그레이션 도중
 * 두 형식이 잠시 함께 있어도 화면과 실행이 같은 값을 보게 하기 위해서다.
 */
export function listLanes(config: LlmLaneConfig): NamedLane[] {
  const named: NamedLane[] = Object.entries(config.lanes ?? {}).map(([name, lane]) => ({
    name,
    lane,
  }));
  const taken = new Set(named.map((entry) => entry.name));
  if (config.inHouse && !taken.has(LEGACY_INHOUSE_LANE_NAME)) {
    named.push({
      name: LEGACY_INHOUSE_LANE_NAME,
      lane: { kind: "inhouse", ...config.inHouse },
    });
  }
  if (config.bedrock && !taken.has(LEGACY_BEDROCK_LANE_NAME)) {
    named.push({
      name: LEGACY_BEDROCK_LANE_NAME,
      lane: { kind: "bedrock", ...config.bedrock },
    });
  }
  return named;
}

/** 이름으로 레인 하나를 찾는다. 없으면 null. */
export function findLane(config: LlmLaneConfig, name: string): LlmLaneEntry | null {
  return listLanes(config).find((entry) => entry.name === name)?.lane ?? null;
}

/**
 * 에이전트가 레인을 고르지 않았을 때 쓸 레인 이름.
 * `defaultLane`이 실재하면 그것을, 아니면 첫 번째 레인을 쓴다.
 */
export function resolveDefaultLaneName(config: LlmLaneConfig): string | null {
  const lanes = listLanes(config);
  if (lanes.length === 0) return null;
  if (config.defaultLane && lanes.some((entry) => entry.name === config.defaultLane)) {
    return config.defaultLane;
  }
  return lanes[0]!.name;
}

/** 레인이 어느 어댑터로 실행되는지. 이 두 가지가 정책이 허용하는 전부다. */
export function adapterTypeForLane(lane: LlmLaneEntry): "claude_local" | "opencode_local" {
  return lane.kind === "bedrock" ? "claude_local" : "opencode_local";
}

/**
 * 레인이 지정하는 모델 id. 사내 모델은 provider를 앞에 붙인 형태여야
 * OpenCode가 사내 게이트웨이로 라우팅한다.
 */
export function modelForLane(lane: LlmLaneEntry): string | null {
  if (lane.kind === "inhouse") return `${lane.providerId}/${lane.model}`;
  return lane.model ?? null;
}

/**
 * 사내 레인의 토큰을 담을 환경 변수 이름.
 *
 * providerId마다 달라야 한다 — 레인이 여러 개인데 이름이 같으면 나중 레인의
 * 토큰이 앞 레인을 덮어써서 조용히 엉뚱한 게이트웨이로 붙는다. 기본 providerId
 * (`corp`)만 예전 이름을 그대로 써서, 레인 하나짜리 기존 설치본의 환경 변수
 * 이름이 바뀌지 않게 한다.
 */
function apiKeyEnvVarFor(providerId: string): string {
  if (providerId === DEFAULT_PROVIDER_ID) return GENERATED_API_KEY_ENV_VAR;
  const suffix = providerId.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  return `${GENERATED_API_KEY_ENV_VAR}_${suffix}`;
}

interface InHouseLaneEnvParts {
  providerId: string;
  qualifiedModel: string;
  providerEntry: Record<string, unknown>;
  modelEntry: { id: string; label: string };
  /** 파일에 토큰을 직접 적었을 때만 채워진다. */
  tokenEnv: Record<string, string>;
}

function buildInHouseLaneParts(lane: z.infer<typeof inHouseLaneSchema>): InHouseLaneEnvParts {
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
  const apiKeyEnvVar = lane.apiKeyEnv ?? apiKeyEnvVarFor(providerId);
  const tokenEnv: Record<string, string> = {};
  if (!lane.apiKeyEnv && lane.apiKey) {
    tokenEnv[apiKeyEnvVar] = lane.apiKey;
  }
  return {
    providerId,
    qualifiedModel,
    providerEntry: {
      npm: lane.npm,
      ...(lane.label ? { name: lane.label } : {}),
      options: { baseURL: lane.baseUrl, apiKey: `{env:${apiKeyEnvVar}}` },
      models: { [lane.model]: lane.label ? { name: lane.label } : {} },
    },
    modelEntry: { id: qualifiedModel, label: lane.label ?? qualifiedModel },
    tokenEnv,
  };
}

/**
 * 설정 파일 내용을 어댑터가 요구하는 환경 변수 모음으로 변환한다.
 * 순수 함수이므로 테스트에서 직접 검증할 수 있다.
 *
 * 사내 레인이 여러 개면 provider 정의를 한 JSON으로 합친다. 그래야 에이전트가
 * `provider/model` 하나만 골라도 어느 게이트웨이로 갈지 정해진다 — 실행 시점에
 * 레인별 환경 변수를 따로 주입할 필요가 없다.
 */
export function buildLaneEnv(config: LlmLaneConfig): Record<string, string> {
  const env: Record<string, string> = {};
  const lanes = listLanes(config);

  const providers: Record<string, unknown> = {};
  const models: Array<{ id: string; label: string }> = [];
  const providerIds: string[] = [];
  const seenProviderIds = new Set<string>();
  let defaultInHouseModel: string | null = null;
  const defaultLaneName = resolveDefaultLaneName(config);

  for (const { name, lane } of lanes) {
    if (lane.kind !== "inhouse") continue;
    const parts = buildInHouseLaneParts(lane);
    if (seenProviderIds.has(parts.providerId)) {
      throw new Error(
        `레인 "${name}"의 providerId "${parts.providerId}"가 다른 레인과 겹칩니다. ` +
          "사내 레인마다 서로 다른 providerId를 쓰세요.",
      );
    }
    seenProviderIds.add(parts.providerId);
    providers[parts.providerId] = parts.providerEntry;
    models.push(parts.modelEntry);
    providerIds.push(parts.providerId);
    Object.assign(env, parts.tokenEnv);
    if (defaultInHouseModel === null || name === defaultLaneName) {
      defaultInHouseModel = parts.qualifiedModel;
    }
  }

  if (providerIds.length > 0) {
    env.PAPERCLIP_OPENCODE_PROVIDERS = JSON.stringify(providers);
    // 보조 모델을 고정하지 않으면 OpenCode가 내장 벤더 모델로 제목을 생성하려다
    // 실행이 중단된다.
    env.PAPERCLIP_OPENCODE_SMALL_MODEL = defaultInHouseModel!;
    env.PAPERCLIP_OPENCODE_CHEAP_MODEL = defaultInHouseModel!;
    // 사내 모델은 `opencode models` 목록에 없으므로 확인 절차를 건너뛴다.
    env.OPENCODE_ALLOW_ALL_MODELS = "true";
    env.PAPERCLIP_ADAPTER_MODELS = JSON.stringify({ opencode_local: models });
    // 정책 모듈이 이 provider 이름들을 사내 게이트웨이로 인정하게 한다.
    env.PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS = providerIds.join(",");
  }

  const bedrockLanes = lanes.filter((entry) => entry.lane.kind === "bedrock");
  if (bedrockLanes.length > 0) {
    const preferred =
      bedrockLanes.find((entry) => entry.name === defaultLaneName) ?? bedrockLanes[0]!;
    const lane = preferred.lane as BedrockLaneEntry;
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    const region = lane.region ?? config.awsSso?.region;
    if (region) env.AWS_REGION = region;
    const profile = lane.profile ?? config.awsSso?.profile;
    if (profile) env.AWS_PROFILE = profile;
  }

  if (config.disableTelemetry) {
    // 두 변수 모두 정확히 "1"이어야 한다. "true"는 무시된다.
    env.PAPERCLIP_TELEMETRY_DISABLED = "1";
    env.DO_NOT_TRACK = "1";
  }

  return env;
}

/**
 * 실행 직전에 특정 레인만을 위해 덮어써야 하는 환경 변수.
 *
 * 사내 레인은 부팅 시점에 provider 정의가 모두 들어가 있고 모델 id가
 * `provider/model`이라 라우팅이 이미 정해지므로 여기서 더 줄 것이 없다.
 * Bedrock은 레인마다 리전/프로필이 다를 수 있어 그 두 개만 실행 단위로 맞춘다.
 */
export function buildRuntimeEnvForLane(
  lane: LlmLaneEntry,
  config: LlmLaneConfig,
): Record<string, string> {
  if (lane.kind !== "bedrock") return {};
  const env: Record<string, string> = { CLAUDE_CODE_USE_BEDROCK: "1" };
  const region = lane.region ?? config.awsSso?.region;
  if (region) env.AWS_REGION = region;
  const profile = lane.profile ?? config.awsSso?.profile;
  if (profile) env.AWS_PROFILE = profile;
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
  if (env === process.env) {
    externallyOwnedEnvKeys = new Set(skipped);
    fileOwnedEnvKeys = new Set(applied);
  }
  return { filePath, applied, skipped };
}

/**
 * 부팅 때 파일보다 우선한다고 판정된 환경 변수 이름들.
 *
 * 재적용은 이 목록만 건너뛴다. 부팅 시점의 판정을 그대로 재사용해야, 파일이
 * 만든 값을 "외부에서 내려준 값"으로 착각해 영원히 갱신하지 않는 일이 없다.
 */
let externallyOwnedEnvKeys = new Set<string>();
/** 재적용이 지운 뒤 다시 채우도록, 파일이 소유한 변수 이름을 기억한다. */
let fileOwnedEnvKeys = new Set<string>();

/**
 * 화면에서 설정을 저장한 뒤 서버를 재시작하지 않고 반영한다.
 *
 * 부팅 때와 달리 파일 값이 이긴다 — 방금 사람이 저장한 값이기 때문이다. 다만
 * 컨테이너나 systemd가 내려준 값(부팅 때 건너뛴 이름)은 계속 지킨다. 이전 저장이
 * 만들었다가 이번에 사라진 변수는 지워야, 삭제한 레인의 provider가 남지 않는다.
 */
export function reapplyLlmLaneConfig(
  env: NodeJS.ProcessEnv = process.env,
  filePath = resolveLlmLaneConfigPath(),
): LlmLaneApplyResult | null {
  const config = readLlmLaneConfig(filePath);
  const laneEnv = config ? buildLaneEnv(config) : {};
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const key of fileOwnedEnvKeys) {
    if (key in laneEnv || externallyOwnedEnvKeys.has(key)) continue;
    delete env[key];
  }
  for (const [key, value] of Object.entries(laneEnv)) {
    if (externallyOwnedEnvKeys.has(key)) {
      skipped.push(key);
      continue;
    }
    env[key] = value;
    applied.push(key);
  }
  fileOwnedEnvKeys = new Set(applied);
  return { filePath, applied, skipped };
}

/** 테스트에서 모듈 상태를 초기화한다. */
export function resetLlmLaneEnvOwnership() {
  externallyOwnedEnvKeys = new Set();
  fileOwnedEnvKeys = new Set();
}
