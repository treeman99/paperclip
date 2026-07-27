/**
 * 에이전트와 LLM 레인을 잇는 자리.
 *
 * 이 배포본에서 에이전트가 LLM에 대해 갖는 설정은 레인 이름 하나뿐이다.
 * 어댑터 종류와 모델 id는 그 레인에서 파생되며, 저장할 때와 실행할 때 두 번
 * 파생시킨다:
 *
 *  - 저장 시점: 목록·상세 화면이 어댑터 종류를 그대로 읽어 쓰므로 에이전트 행에
 *    맞는 값을 넣어 둔다.
 *  - 실행 시점: 사내 모델은 그때그때 바뀐다. 설정 화면에서 모델을 바꿨을 때
 *    에이전트를 하나씩 다시 저장하게 만들지 않으려면, 실행 직전에 레인의 현재
 *    값으로 다시 덮어써야 한다.
 *
 * 레인을 고르지 않은 에이전트(예전에 만들어진 것)는 건드리지 않는다. 정책 검사가
 * 이미 두 레인 밖의 조합을 거부하므로, 여기서 임의로 바꾸면 사용자가 의도한
 * 설정을 조용히 갈아엎는 셈이 된다.
 */

import {
  adapterTypeForLane,
  buildRuntimeEnvForLane,
  findLane,
  modelForLane,
  readLlmLaneConfig,
  resolveDefaultLaneName,
  type LlmLaneConfig,
  type LlmLaneEntry,
} from "./llm-lane-config.js";

/** 에이전트의 adapterConfig에 레인 이름을 담는 키. */
export const AGENT_LANE_CONFIG_KEY = "llmLane";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readAgentLaneName(adapterConfig: unknown): string | null {
  const config = asRecord(adapterConfig);
  const raw = config?.[AGENT_LANE_CONFIG_KEY];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ResolvedAgentLane {
  name: string;
  lane: LlmLaneEntry;
  config: LlmLaneConfig;
}

/**
 * 에이전트가 고른 레인을 찾는다. 이름이 없으면 기본 레인으로 넘어간다.
 *
 * 설정 파일을 읽지 못하면(파일이 깨졌거나 지워졌거나) null을 돌려준다. 실행 경로에서
 * 예외를 던지면 "설정 파일이 잘못됨"이 "에이전트 실행 실패"로 둔갑하고, 그쪽은
 * 이미 정책 검사가 더 정확한 메시지로 잡아 준다.
 */
export function resolveAgentLane(
  adapterConfig: unknown,
  filePath?: string,
): ResolvedAgentLane | null {
  let config: LlmLaneConfig | null;
  try {
    config = readLlmLaneConfig(filePath);
  } catch {
    return null;
  }
  if (!config) return null;
  const name = readAgentLaneName(adapterConfig) ?? resolveDefaultLaneName(config);
  if (!name) return null;
  const lane = findLane(config, name);
  if (!lane) return null;
  return { name, lane, config };
}

/**
 * 저장되는 에이전트 값을 레인에 맞춘다.
 *
 * 레인을 고르지 않았으면 아무것도 바꾸지 않는다. 골랐다면 어댑터 종류는 레인이
 * 정하며, 모델은 레인이 지정한 것이 있을 때만 덮어쓴다 — Bedrock 레인은 모델을
 * 비워 둘 수 있고, 그때는 에이전트에 저장된 값이 살아 있어야 한다.
 */
export function applyLaneToAgentInput(
  input: { adapterType?: string | null; adapterConfig?: Record<string, unknown> | null },
  filePath?: string,
): { adapterType: string | null; adapterConfig: Record<string, unknown> | null } {
  const adapterConfig = input.adapterConfig ?? null;
  const laneName = readAgentLaneName(adapterConfig);
  if (!laneName) {
    return { adapterType: input.adapterType ?? null, adapterConfig };
  }
  const resolved = resolveAgentLane(adapterConfig, filePath);
  if (!resolved || resolved.name !== laneName) {
    throw new Error(
      `LLM 레인 "${laneName}"을 찾을 수 없습니다. 설정 화면에서 레인을 먼저 만드세요.`,
    );
  }
  const model = modelForLane(resolved.lane);
  return {
    adapterType: adapterTypeForLane(resolved.lane),
    adapterConfig: {
      ...adapterConfig,
      [AGENT_LANE_CONFIG_KEY]: resolved.name,
      ...(model ? { model } : {}),
    },
  };
}

/**
 * 실행 직전 설정을 레인의 현재 값으로 맞춘다.
 *
 * 원본을 그대로 두고 새 객체를 돌려주므로, 호출한 쪽이 저장된 에이전트 설정을
 * 실수로 바꿔 버리는 일이 없다.
 */
export function applyLaneToRuntimeConfig(
  resolvedConfig: Record<string, unknown>,
  filePath?: string,
): Record<string, unknown> {
  // 레인을 명시적으로 고른 에이전트만 덮어쓴다. 여기서 기본 레인으로 넘어가면,
  // 레인 개념이 생기기 전에 만들어진 에이전트의 모델이 어느 날 조용히 바뀐다.
  if (!readAgentLaneName(resolvedConfig)) return resolvedConfig;
  const resolved = resolveAgentLane(resolvedConfig, filePath);
  if (!resolved) return resolvedConfig;

  const next = { ...resolvedConfig };
  const model = modelForLane(resolved.lane);
  if (model) next.model = model;

  const laneEnv = buildRuntimeEnvForLane(resolved.lane, resolved.config);
  if (Object.keys(laneEnv).length > 0) {
    // 레인 값이 이긴다. 예전에 저장된 AWS_REGION이 남아 있으면 지금 고른 레인과
    // 다른 리전으로 요청이 나가고, 그건 조용히 실패하거나 조용히 비싸진다.
    next.env = { ...(asRecord(resolvedConfig.env) ?? {}), ...laneEnv };
  }
  return next;
}
