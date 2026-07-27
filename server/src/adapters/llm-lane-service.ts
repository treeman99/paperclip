/**
 * LLM 레인 설정 화면이 쓰는 서비스 계층.
 *
 * 화면은 `llm-lanes.json`을 직접 만지지 않고 이 모듈을 거친다. 그래야 토큰이
 * 화면으로 흘러나가지 않고(읽을 때는 있음/없음만 알려 준다), 저장 직후 환경
 * 변수 재적용까지 한 곳에서 끝난다.
 *
 * 저장은 항상 파일 전체를 다시 쓴다. 레인 수가 많아야 서너 개인 설정이라
 * 부분 갱신을 위한 복잡도를 감수할 이유가 없다.
 */

import {
  buildLaneEnv,
  findLane,
  listLanes,
  readLlmLaneConfig,
  reapplyLlmLaneConfig,
  resolveDefaultLaneName,
  resolveLlmLaneConfigPath,
  writeLlmLaneConfig,
  type BedrockLaneEntry,
  type LlmLaneConfig,
  type LlmLaneEntry,
} from "./llm-lane-config.js";
import { getAwsSsoStatus, type AwsSsoStatus } from "./aws-sso.js";

/** 화면에 내려보내는 레인. 토큰 값은 절대 포함하지 않는다. */
export interface LaneSummary {
  name: string;
  kind: "inhouse" | "bedrock";
  label: string | null;
  model: string | null;
  /** 어댑터가 실제로 실행할 때 쓰는 모델 id. 사내 레인은 provider가 앞에 붙는다. */
  qualifiedModel: string | null;
  adapterType: "claude_local" | "opencode_local";
  isDefault: boolean;
  /** 사내 레인 전용 */
  baseUrl?: string;
  providerId?: string;
  hasApiKey?: boolean;
  apiKeyEnv?: string | null;
  /**
   * Bedrock 레인 전용. 레인에 직접 적힌 값만 담는다 — 비어 있으면 SSO 기본 리전을
   * 물려받는다는 뜻이고, 수정 화면은 이 구분을 그대로 되돌려 보내야 한다.
   */
  region?: string | null;
  /** 실제로 쓰이게 될 리전. 목록에 보여 주기 위한 값이다. */
  effectiveRegion?: string | null;
}

export interface LlmLaneSettings {
  filePath: string;
  /** 설정 파일이 아예 없는 상태. 화면이 첫 설정 안내를 띄우는 데 쓴다. */
  configured: boolean;
  lanes: LaneSummary[];
  defaultLane: string | null;
  awsSso: { profile: string | null; region: string | null };
}

function emptyConfig(): LlmLaneConfig {
  return { disableTelemetry: true };
}

function loadConfig(filePath?: string): LlmLaneConfig {
  return readLlmLaneConfig(filePath ?? resolveLlmLaneConfigPath()) ?? emptyConfig();
}

function summarize(config: LlmLaneConfig): LaneSummary[] {
  const defaultLane = resolveDefaultLaneName(config);
  return listLanes(config).map(({ name, lane }) => {
    const base = {
      name,
      kind: lane.kind,
      label: lane.label ?? null,
      isDefault: name === defaultLane,
      adapterType: lane.kind === "bedrock" ? ("claude_local" as const) : ("opencode_local" as const),
    };
    if (lane.kind === "inhouse") {
      return {
        ...base,
        model: lane.model,
        qualifiedModel: `${lane.providerId}/${lane.model}`,
        baseUrl: lane.baseUrl,
        providerId: lane.providerId,
        hasApiKey: !!lane.apiKey || !!lane.apiKeyEnv,
        apiKeyEnv: lane.apiKeyEnv ?? null,
      };
    }
    return {
      ...base,
      model: lane.model ?? null,
      qualifiedModel: lane.model ?? null,
      region: lane.region ?? null,
      effectiveRegion: lane.region ?? config.awsSso?.region ?? null,
    };
  });
}

export function getLlmLaneSettings(filePath?: string): LlmLaneSettings {
  const resolvedPath = filePath ?? resolveLlmLaneConfigPath();
  const raw = readLlmLaneConfig(resolvedPath);
  const config = raw ?? emptyConfig();
  return {
    filePath: resolvedPath,
    configured: raw !== null,
    lanes: summarize(config),
    defaultLane: resolveDefaultLaneName(config),
    awsSso: {
      profile: config.awsSso?.profile ?? null,
      region: config.awsSso?.region ?? null,
    },
  };
}

/**
 * 화면에서 올라오는 레인 입력.
 *
 * `apiKey`가 undefined면 기존 토큰을 유지하고, 빈 문자열이면 지운다. 화면은
 * 토큰을 되돌려받지 못하므로, 저장할 때마다 다시 입력하게 하지 않으려면 이
 * 구분이 필요하다.
 */
export interface LaneInput {
  kind: "inhouse" | "bedrock";
  label?: string | null;
  model?: string | null;
  baseUrl?: string;
  providerId?: string;
  apiKey?: string;
  apiKeyEnv?: string | null;
  npm?: string;
  region?: string | null;
  profile?: string | null;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
}

/**
 * 예전 형식(`inHouse`/`bedrock`)을 `lanes`로 옮긴다.
 *
 * 저장이 일어나는 순간에만 옮긴다. 읽기만 할 때는 파일을 건드리지 않아야,
 * 화면을 열어 보기만 한 사용자의 설정 파일이 조용히 바뀌지 않는다.
 */
function migrateLegacy(config: LlmLaneConfig): LlmLaneConfig {
  if (!config.inHouse && !config.bedrock) return config;
  const lanes: Record<string, LlmLaneEntry> = { ...(config.lanes ?? {}) };
  for (const { name, lane } of listLanes(config)) {
    if (!(name in lanes)) lanes[name] = lane;
  }
  const next = { ...config, lanes };
  delete next.inHouse;
  delete next.bedrock;
  return next;
}

function buildLaneEntry(
  input: LaneInput,
  previous: LlmLaneEntry | null,
): LlmLaneEntry {
  if (input.kind === "bedrock") {
    const previousBedrock = previous?.kind === "bedrock" ? previous : null;
    return {
      kind: "bedrock",
      ...(trimmed(input.region) ? { region: trimmed(input.region)! } : {}),
      ...(trimmed(input.model) ? { model: trimmed(input.model)! } : {}),
      ...(trimmed(input.profile) ?? previousBedrock?.profile
        ? { profile: (trimmed(input.profile) ?? previousBedrock?.profile)! }
        : {}),
      ...(trimmed(input.label) ? { label: trimmed(input.label)! } : {}),
    };
  }

  const previousInHouse = previous?.kind === "inhouse" ? previous : null;
  const baseUrl = trimmed(input.baseUrl);
  const model = trimmed(input.model);
  if (!baseUrl) throw new Error("사내 모델 레인에는 서버 주소(baseUrl)가 필요합니다.");
  if (!model) throw new Error("사내 모델 레인에는 모델 이름이 필요합니다.");

  const apiKeyEnv = input.apiKeyEnv === null ? undefined : trimmed(input.apiKeyEnv)
    ?? (input.apiKeyEnv === undefined ? previousInHouse?.apiKeyEnv : undefined);
  // 토큰: 안 보내면 유지, 빈 문자열이면 삭제, 값이 있으면 교체.
  const apiKey = input.apiKey === undefined
    ? previousInHouse?.apiKey
    : trimmed(input.apiKey);
  if (!apiKey && !apiKeyEnv) {
    throw new Error("사내 모델 레인에는 토큰이나 토큰을 담은 환경 변수 이름이 필요합니다.");
  }
  return {
    kind: "inhouse",
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    providerId: trimmed(input.providerId) ?? previousInHouse?.providerId ?? "corp",
    ...(trimmed(input.label) ? { label: trimmed(input.label)! } : {}),
    npm: trimmed(input.npm) ?? previousInHouse?.npm ?? "@ai-sdk/openai-compatible",
  };
}

function persist(config: LlmLaneConfig, filePath?: string): LlmLaneSettings {
  const resolvedPath = filePath ?? resolveLlmLaneConfigPath();
  // 쓰기 전에 환경 변수로 펼쳐 본다. providerId 충돌처럼 파일만 봐서는 알 수 없는
  // 문제를 저장 시점에 잡아야, 다음 실행에서야 터지는 일이 없다.
  buildLaneEnv(config);
  writeLlmLaneConfig(config, resolvedPath);
  if (resolvedPath === resolveLlmLaneConfigPath()) reapplyLlmLaneConfig();
  return getLlmLaneSettings(resolvedPath);
}

export function saveLane(
  name: string,
  input: LaneInput,
  options: { previousName?: string | null; filePath?: string } = {},
): LlmLaneSettings {
  const laneName = name.trim();
  if (!laneName) throw new Error("레인 이름을 입력하세요.");
  const config = migrateLegacy(loadConfig(options.filePath));
  const previousName = options.previousName?.trim() || null;
  const previous = previousName ? findLane(config, previousName) : findLane(config, laneName);
  const lanes: Record<string, LlmLaneEntry> = { ...(config.lanes ?? {}) };
  if (previousName && previousName !== laneName) delete lanes[previousName];
  lanes[laneName] = buildLaneEntry(input, previous);

  const next: LlmLaneConfig = { ...config, lanes };
  // 이름을 바꿨는데 그 레인이 기본값이었다면 기본값도 따라가야 한다.
  if (previousName && previousName !== laneName && config.defaultLane === previousName) {
    next.defaultLane = laneName;
  }
  if (!next.defaultLane) next.defaultLane = laneName;
  return persist(next, options.filePath);
}

export function deleteLane(name: string, filePath?: string): LlmLaneSettings {
  const config = migrateLegacy(loadConfig(filePath));
  const lanes = { ...(config.lanes ?? {}) };
  if (!(name in lanes)) throw new Error(`레인 "${name}"이 없습니다.`);
  delete lanes[name];
  const next: LlmLaneConfig = { ...config, lanes };
  if (next.defaultLane === name) delete next.defaultLane;
  return persist(next, filePath);
}

export function setDefaultLane(name: string | null, filePath?: string): LlmLaneSettings {
  const config = migrateLegacy(loadConfig(filePath));
  if (name && !findLane(config, name)) throw new Error(`레인 "${name}"이 없습니다.`);
  const next: LlmLaneConfig = { ...config };
  if (name) next.defaultLane = name;
  else delete next.defaultLane;
  return persist(next, filePath);
}

export function saveAwsSso(
  input: { profile: string | null; region?: string | null },
  filePath?: string,
): LlmLaneSettings {
  const config = migrateLegacy(loadConfig(filePath));
  const next: LlmLaneConfig = { ...config };
  const profile = trimmed(input.profile);
  if (!profile) {
    delete next.awsSso;
  } else {
    next.awsSso = {
      ...config.awsSso,
      profile,
      ...(trimmed(input.region) ? { region: trimmed(input.region)! } : {}),
    };
    if (!trimmed(input.region)) delete next.awsSso.region;
  }
  return persist(next, filePath);
}

/** 사내 레인의 토큰 실제 값. 연결 테스트와 모델 목록 조회에만 쓴다. */
function resolveInHouseToken(lane: Extract<LlmLaneEntry, { kind: "inhouse" }>): string | null {
  if (lane.apiKeyEnv) return process.env[lane.apiKeyEnv]?.trim() || null;
  return lane.apiKey ?? null;
}

export type LaneTestResult =
  | { ok: true; detail: string; models?: string[] }
  | { ok: false; detail: string };

/**
 * 사내 게이트웨이의 모델 목록을 가져온다.
 *
 * 사내 모델은 그때그때 바뀌고 운영 주체도 다르므로 모델 이름을 고정해 둘 수 없다.
 * OpenAI 호환 서버라면 `/models`가 현재 서빙 중인 이름을 알려 주므로, 화면에서
 * 그걸 그대로 고르게 한다. 이 엔드포인트가 없는 서버도 있어 실패는 치명적이지
 * 않게 다룬다 — 사용자가 이름을 직접 입력하면 된다.
 */
export async function fetchInHouseModels(input: {
  baseUrl: string;
  token: string | null;
  timeoutMs?: number;
}): Promise<string[]> {
  const url = `${input.baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15_000);
  try {
    const response = await fetch(url, {
      headers: input.token ? { Authorization: `Bearer ${input.token}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? [])
      .map((entry) => (typeof entry.id === "string" ? entry.id : null))
      .filter((id): id is string => !!id);
  } finally {
    clearTimeout(timer);
  }
}

/** 레인이 실제로 붙는지 확인한다. 저장 전에 눌러 볼 수 있도록 입력값으로도 받는다. */
export async function testLane(
  lane: LlmLaneEntry,
  config: LlmLaneConfig,
): Promise<LaneTestResult> {
  if (lane.kind === "inhouse") {
    const token = resolveInHouseToken(lane);
    if (!token) {
      return {
        ok: false,
        detail: lane.apiKeyEnv
          ? `환경 변수 ${lane.apiKeyEnv} 에 토큰이 들어 있지 않습니다.`
          : "토큰이 설정되지 않았습니다.",
      };
    }
    try {
      const models = await fetchInHouseModels({ baseUrl: lane.baseUrl, token });
      if (models.length === 0) {
        return {
          ok: true,
          detail: "서버에 연결했지만 모델 목록이 비어 있습니다. 모델 이름은 직접 입력하세요.",
          models,
        };
      }
      const known = models.includes(lane.model);
      return {
        ok: true,
        detail: known
          ? `연결됨. "${lane.model}" 모델이 서버 목록에 있습니다.`
          : `연결됨. 다만 "${lane.model}" 은 서버 목록에 없습니다 (${models.length}개 중). 이름을 확인하세요.`,
        models,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: `연결하지 못했습니다: ${reason}` };
    }
  }

  const bedrock = lane as BedrockLaneEntry;
  const profile = bedrock.profile ?? config.awsSso?.profile;
  if (!profile) {
    return { ok: false, detail: "AWS SSO 프로필이 설정되지 않았습니다." };
  }
  const status: AwsSsoStatus = await getAwsSsoStatus(profile);
  if (status.state === "logged_in") {
    return {
      ok: true,
      detail: `AWS 자격증명이 유효합니다 (계정 ${status.accountId ?? "확인 불가"}).`,
    };
  }
  if (status.state === "profile_missing") {
    return { ok: false, detail: `${status.message} ${status.remediation}` };
  }
  return { ok: false, detail: status.message };
}

/** 이름으로 레인을 찾아 테스트한다. */
export async function testLaneByName(
  name: string,
  filePath?: string,
): Promise<LaneTestResult> {
  const config = loadConfig(filePath);
  const lane = findLane(config, name);
  if (!lane) return { ok: false, detail: `레인 "${name}"이 없습니다.` };
  return testLane(lane, config);
}

/** 저장 전 입력값으로 테스트한다. 토큰을 안 보냈으면 저장된 값을 쓴다. */
export async function testLaneInput(
  input: LaneInput & { name?: string },
  filePath?: string,
): Promise<LaneTestResult> {
  const config = loadConfig(filePath);
  const previous = input.name ? findLane(config, input.name) : null;
  let lane: LlmLaneEntry;
  try {
    lane = buildLaneEntry(input, previous);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  return testLane(lane, config);
}
