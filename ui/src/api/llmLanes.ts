/**
 * LLM 연결 설정 화면의 API 클라이언트.
 *
 * 토큰은 한 방향으로만 흐른다 — 저장할 때는 올려보내고, 읽을 때는 있음/없음만
 * 돌려받는다. 그래서 수정 화면은 토큰 칸을 비워 두고, 비워 둔 채로 저장하면
 * 서버가 기존 토큰을 유지한다.
 */

import { api } from "./client";

export type LaneKind = "inhouse" | "bedrock";

export interface LaneSummary {
  name: string;
  kind: LaneKind;
  label: string | null;
  model: string | null;
  qualifiedModel: string | null;
  adapterType: "claude_local" | "opencode_local";
  isDefault: boolean;
  baseUrl?: string;
  providerId?: string;
  hasApiKey?: boolean;
  apiKeyEnv?: string | null;
  /** 레인에 직접 적힌 리전. 비어 있으면 SSO 기본 리전을 물려받는다. */
  region?: string | null;
  /** 실제로 쓰이게 될 리전(물려받은 값 포함). 표시 전용. */
  effectiveRegion?: string | null;
}

export interface LlmLaneSettings {
  filePath: string;
  configured: boolean;
  lanes: LaneSummary[];
  defaultLane: string | null;
  awsSso: { profile: string | null; region: string | null };
}

export interface LanePayload {
  kind: LaneKind;
  label?: string | null;
  model?: string | null;
  baseUrl?: string;
  providerId?: string;
  /** 생략하면 기존 토큰 유지, 빈 문자열이면 삭제. */
  apiKey?: string;
  apiKeyEnv?: string | null;
  region?: string | null;
  previousName?: string | null;
}

export type LaneTestResult =
  | { ok: true; detail: string; models?: string[] }
  | { ok: false; detail: string };

export type AwsSsoStatus =
  | { state: "cli_missing"; message: string }
  | { state: "profile_missing"; message: string; remediation: string }
  | { state: "logged_out"; message: string }
  | { state: "logged_in"; accountId: string | null; arn: string | null };

export type AwsSsoLoginState =
  | { state: "idle" }
  | {
      state: "pending";
      profile: string;
      verificationUrl: string | null;
      userCode: string | null;
      output: string;
    }
  | { state: "succeeded"; profile: string; output: string }
  | { state: "failed"; profile: string; output: string; message: string };

export interface AwsSsoSnapshot {
  status: AwsSsoStatus;
  login: AwsSsoLoginState;
}

/** 에이전트 설정 화면이 보는 최소 정보. 서버 주소·토큰은 담기지 않는다. */
export interface LaneOption {
  name: string;
  kind: LaneKind;
  label: string | null;
  model: string | null;
  qualifiedModel: string | null;
  adapterType: "claude_local" | "opencode_local";
  isDefault: boolean;
}

export const llmLanesApi = {
  get: () => api.get<LlmLaneSettings>("/instance/llm-lanes"),
  options: () => api.get<LaneOption[]>("/instance/llm-lane-options"),
  save: (name: string, payload: LanePayload) =>
    api.put<LlmLaneSettings>(`/instance/llm-lanes/${encodeURIComponent(name)}`, payload),
  remove: (name: string, options: { force?: boolean } = {}) =>
    api.delete<LlmLaneSettings>(
      `/instance/llm-lanes/${encodeURIComponent(name)}${options.force ? "?force=true" : ""}`,
    ),
  makeDefault: (name: string) =>
    api.post<LlmLaneSettings>(`/instance/llm-lanes/${encodeURIComponent(name)}/default`, {}),
  test: (name: string) =>
    api.post<LaneTestResult>(`/instance/llm-lanes/${encodeURIComponent(name)}/test`, {}),
  testDraft: (payload: LanePayload & { name?: string }) =>
    api.post<LaneTestResult>("/instance/llm-lanes-test", payload),
  agentsUsing: (name: string) =>
    api.get<Array<{ id: string; name: string }>>(
      `/instance/llm-lanes/${encodeURIComponent(name)}/agents`,
    ),
  saveAwsSso: (payload: { profile: string | null; region: string | null }) =>
    api.put<LlmLaneSettings>("/instance/aws-sso", payload),
  awsSsoStatus: () => api.get<AwsSsoSnapshot>("/instance/aws-sso/status"),
  awsSsoLogin: () => api.post<AwsSsoLoginState>("/instance/aws-sso/login", {}),
  cancelAwsSsoLogin: () => api.delete<AwsSsoLoginState>("/instance/aws-sso/login"),
};
