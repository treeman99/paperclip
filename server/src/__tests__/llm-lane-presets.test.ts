/**
 * 이름 붙인 레인(프리셋) 동작 검증.
 *
 * 여기서 지키려는 것은 세 가지다:
 *  - 예전 형식으로 저장된 설치본이 그대로 계속 돈다.
 *  - 레인이 여러 개일 때 서로의 토큰이나 provider를 덮어쓰지 않는다.
 *  - 화면이 저장한 값에서 토큰이 다시 새어 나오지 않는다.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLaneEnv,
  buildRuntimeEnvForLane,
  findLane,
  LEGACY_BEDROCK_LANE_NAME,
  LEGACY_INHOUSE_LANE_NAME,
  listLanes,
  readLlmLaneConfig,
  resolveDefaultLaneName,
  writeLlmLaneConfig,
  type LlmLaneConfig,
} from "../adapters/llm-lane-config.js";
import {
  deleteLane,
  getLlmLaneSettings,
  saveAwsSso,
  saveLane,
  setDefaultLane,
} from "../adapters/llm-lane-service.js";

let tmpDir: string;
let configPath: string;

function write(value: unknown): string {
  fs.writeFileSync(configPath, JSON.stringify(value, null, 2));
  return configPath;
}

const INHOUSE = {
  kind: "inhouse" as const,
  baseUrl: "https://a.corp.internal/v1",
  model: "coder-a",
  apiKey: "sk-a",
  providerId: "corp",
  npm: "@ai-sdk/openai-compatible",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-lane-presets-"));
  configPath = path.join(tmpDir, "llm-lanes.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("레인 목록", () => {
  it("예전 형식은 이름 붙은 레인으로 환산된다", () => {
    write({
      inHouse: { baseUrl: "https://x/v1", model: "m", apiKeyEnv: "K" },
      bedrock: { region: "us-west-2" },
    });
    const config = readLlmLaneConfig(configPath)!;
    const names = listLanes(config).map((entry) => entry.name);
    expect(names).toEqual([LEGACY_INHOUSE_LANE_NAME, LEGACY_BEDROCK_LANE_NAME]);
  });

  it("같은 이름이면 새 형식이 이긴다", () => {
    write({
      lanes: { [LEGACY_INHOUSE_LANE_NAME]: { ...INHOUSE, model: "새-모델" } },
      inHouse: { baseUrl: "https://x/v1", model: "옛-모델", apiKeyEnv: "K" },
    });
    const config = readLlmLaneConfig(configPath)!;
    const lane = findLane(config, LEGACY_INHOUSE_LANE_NAME)!;
    expect(lane.kind === "inhouse" && lane.model).toBe("새-모델");
  });

  it("defaultLane이 없는 이름을 가리키면 첫 레인으로 넘어간다", () => {
    write({ lanes: { A: INHOUSE }, defaultLane: "없는레인" });
    expect(resolveDefaultLaneName(readLlmLaneConfig(configPath)!)).toBe("A");
  });
});

describe("여러 레인의 환경 변수", () => {
  it("provider 정의를 하나의 JSON으로 합친다", () => {
    const config: LlmLaneConfig = {
      lanes: {
        A: INHOUSE,
        B: { ...INHOUSE, baseUrl: "https://b.corp.internal/v1", model: "coder-b", providerId: "corp2", apiKey: "sk-b" },
      },
      disableTelemetry: false,
    };
    const env = buildLaneEnv(config);
    const providers = JSON.parse(env.PAPERCLIP_OPENCODE_PROVIDERS);
    expect(Object.keys(providers).sort()).toEqual(["corp", "corp2"]);
    expect(env.PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS).toBe("corp,corp2");
    const models = JSON.parse(env.PAPERCLIP_ADAPTER_MODELS).opencode_local as Array<{ id: string }>;
    expect(models.map((entry) => entry.id).sort()).toEqual(["corp/coder-a", "corp2/coder-b"]);
  });

  it("레인마다 다른 변수에 토큰을 담아 서로 덮어쓰지 않는다", () => {
    const env = buildLaneEnv({
      lanes: {
        A: INHOUSE,
        B: { ...INHOUSE, providerId: "corp2", apiKey: "sk-b" },
      },
      disableTelemetry: false,
    });
    const tokenVars = Object.entries(env).filter(([, value]) => value.startsWith("sk-"));
    expect(tokenVars).toHaveLength(2);
    expect(new Set(tokenVars.map(([key]) => key)).size).toBe(2);
    // 토큰은 provider JSON에 평문으로 나오지 않는다.
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS).not.toContain("sk-a");
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS).not.toContain("sk-b");
  });

  it("providerId가 겹치면 어느 레인인지 알려주며 거부한다", () => {
    expect(() =>
      buildLaneEnv({
        lanes: { A: INHOUSE, B: { ...INHOUSE, apiKey: "sk-b" } },
        disableTelemetry: false,
      }),
    ).toThrow(/B.*corp/);
  });

  it("보조 모델은 기본 레인의 모델을 따른다", () => {
    const env = buildLaneEnv({
      lanes: {
        A: INHOUSE,
        B: { ...INHOUSE, model: "coder-b", providerId: "corp2", apiKey: "sk-b" },
      },
      defaultLane: "B",
      disableTelemetry: false,
    });
    expect(env.PAPERCLIP_OPENCODE_SMALL_MODEL).toBe("corp2/coder-b");
  });

  it("Bedrock 레인은 SSO 프로필을 물려받는다", () => {
    const env = buildLaneEnv({
      lanes: { B: { kind: "bedrock", model: "us.anthropic.claude-x" } },
      awsSso: { profile: "corp-sso", region: "ap-northeast-2" },
      disableTelemetry: false,
    });
    expect(env.AWS_PROFILE).toBe("corp-sso");
    expect(env.AWS_REGION).toBe("ap-northeast-2");
  });
});

describe("실행 시점 환경 변수", () => {
  it("사내 레인은 부팅 설정으로 충분하므로 추가로 줄 것이 없다", () => {
    expect(buildRuntimeEnvForLane(INHOUSE, { disableTelemetry: true })).toEqual({});
  });

  it("Bedrock 레인은 리전과 프로필을 실행 단위로 고정한다", () => {
    const env = buildRuntimeEnvForLane(
      { kind: "bedrock", region: "us-east-1" },
      { awsSso: { profile: "corp-sso", region: "us-west-2" }, disableTelemetry: true },
    );
    // 레인이 지정한 리전이 SSO 기본값을 이긴다.
    expect(env).toEqual({
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: "us-east-1",
      AWS_PROFILE: "corp-sso",
    });
  });
});

describe("설정 저장", () => {
  it("토큰을 안 보내면 저장된 값을 유지한다", () => {
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-원본" }, { filePath: configPath });
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m2" }, { filePath: configPath });

    const config = readLlmLaneConfig(configPath)!;
    const lane = findLane(config, "A")!;
    expect(lane.kind === "inhouse" && lane.apiKey).toBe("sk-원본");
    expect(lane.kind === "inhouse" && lane.model).toBe("m2");
  });

  it("화면에 내려주는 값에는 토큰이 없다", () => {
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-비밀" }, { filePath: configPath });
    const settings = getLlmLaneSettings(configPath);
    expect(JSON.stringify(settings)).not.toContain("sk-비밀");
    expect(settings.lanes[0]!.hasApiKey).toBe(true);
  });

  it("첫 레인이 자동으로 기본값이 된다", () => {
    const settings = saveLane(
      "A",
      { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-a" },
      { filePath: configPath },
    );
    expect(settings.defaultLane).toBe("A");
  });

  it("이름을 바꾸면 기본 레인 지정도 따라간다", () => {
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-a" }, { filePath: configPath });
    const settings = saveLane(
      "B",
      { kind: "inhouse", baseUrl: "https://a/v1", model: "m" },
      { previousName: "A", filePath: configPath },
    );
    expect(settings.lanes.map((lane) => lane.name)).toEqual(["B"]);
    expect(settings.defaultLane).toBe("B");
  });

  it("저장할 때 예전 형식을 새 형식으로 옮긴다", () => {
    write({ inHouse: { baseUrl: "https://x/v1", model: "m", apiKeyEnv: "K" } });
    saveLane(
      "새레인",
      { kind: "bedrock", region: "us-west-2", model: "us.anthropic.claude-x" },
      { filePath: configPath },
    );
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(raw.inHouse).toBeUndefined();
    expect(Object.keys(raw.lanes).sort()).toEqual([LEGACY_INHOUSE_LANE_NAME, "새레인"].sort());
  });

  it("providerId가 겹치는 저장은 파일을 바꾸지 않고 거부한다", () => {
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-a" }, { filePath: configPath });
    const before = fs.readFileSync(configPath, "utf-8");
    expect(() =>
      saveLane("B", { kind: "inhouse", baseUrl: "https://b/v1", model: "m", apiKey: "sk-b" }, { filePath: configPath }),
    ).toThrow(/providerId/);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(before);
  });

  it("기본 레인을 지우면 기본 지정이 남은 레인으로 넘어간다", () => {
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-a" }, { filePath: configPath });
    saveLane("B", { kind: "bedrock", region: "us-west-2" }, { filePath: configPath });
    setDefaultLane("B", configPath);
    const settings = deleteLane("B", configPath);
    expect(settings.lanes.map((lane) => lane.name)).toEqual(["A"]);
    expect(settings.defaultLane).toBe("A");
  });

  it("AWS SSO 프로필을 저장하고 지울 수 있다", () => {
    let settings = saveAwsSso({ profile: "corp-sso", region: "us-west-2" }, configPath);
    expect(settings.awsSso).toEqual({ profile: "corp-sso", region: "us-west-2" });
    settings = saveAwsSso({ profile: null }, configPath);
    expect(settings.awsSso.profile).toBeNull();
  });

  it("토큰이 담긴 파일은 소유자만 읽도록 만든다", () => {
    if (process.platform === "win32") return;
    saveLane("A", { kind: "inhouse", baseUrl: "https://a/v1", model: "m", apiKey: "sk-a" }, { filePath: configPath });
    expect(fs.statSync(configPath).mode & 0o077).toBe(0);
  });

  it("이미 있던 파일을 덮어써도 권한이 넓어지지 않는다", () => {
    if (process.platform === "win32") return;
    fs.writeFileSync(configPath, "{}", { mode: 0o644 });
    writeLlmLaneConfig({ lanes: { A: INHOUSE }, disableTelemetry: true }, configPath);
    expect(fs.statSync(configPath).mode & 0o077).toBe(0);
  });
});
