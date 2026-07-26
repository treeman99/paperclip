import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLlmLaneConfig,
  buildLaneEnv,
  readLlmLaneConfig,
} from "../adapters/llm-lane-config.js";

let tmpDir: string;

function writeConfig(value: unknown): string {
  const filePath = path.join(tmpDir, "llm-lanes.json");
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

const IN_HOUSE = {
  baseUrl: "https://llm.corp.internal/v1",
  model: "my-coder-model",
  apiKeyEnv: "CORP_LLM_KEY",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-lane-config-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("설정 파일 읽기", () => {
  it("파일이 없으면 null을 돌려준다", () => {
    expect(readLlmLaneConfig(path.join(tmpDir, "없는파일.json"))).toBeNull();
  });

  it("JSON이 깨졌으면 파일 경로를 알려주며 실패한다", () => {
    const filePath = path.join(tmpDir, "llm-lanes.json");
    fs.writeFileSync(filePath, "{ 이건 JSON이 아님");
    expect(() => readLlmLaneConfig(filePath)).toThrow(/읽지 못했습니다/);
  });

  it("필수 항목이 빠지면 어느 항목인지 알려준다", () => {
    const filePath = writeConfig({ inHouse: { baseUrl: "https://x/v1" } });
    expect(() => readLlmLaneConfig(filePath)).toThrow(/inHouse\.model/);
  });

  it("providerId를 생략하면 corp이 된다", () => {
    const filePath = writeConfig({ inHouse: IN_HOUSE });
    expect(readLlmLaneConfig(filePath)?.inHouse?.providerId).toBe("corp");
  });
});

describe("환경 변수 생성", () => {
  it("사내 모델 설정에서 필요한 변수를 모두 만들어 준다", () => {
    const env = buildLaneEnv({ inHouse: { ...IN_HOUSE, providerId: "corp", npm: "@ai-sdk/openai-compatible" }, disableTelemetry: true });

    expect(Object.keys(env).sort()).toEqual([
      "DO_NOT_TRACK",
      "OPENCODE_ALLOW_ALL_MODELS",
      "PAPERCLIP_ADAPTER_MODELS",
      "PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS",
      "PAPERCLIP_OPENCODE_CHEAP_MODEL",
      "PAPERCLIP_OPENCODE_PROVIDERS",
      "PAPERCLIP_OPENCODE_SMALL_MODEL",
      "PAPERCLIP_TELEMETRY_DISABLED",
    ]);
  });

  it("provider 이름을 붙인 모델 이름을 쓴다", () => {
    const env = buildLaneEnv({ inHouse: { ...IN_HOUSE, providerId: "inhouse", npm: "@ai-sdk/openai-compatible" }, disableTelemetry: false });
    expect(env.PAPERCLIP_OPENCODE_SMALL_MODEL).toBe("inhouse/my-coder-model");
    expect(env.PAPERCLIP_OPENCODE_CHEAP_MODEL).toBe("inhouse/my-coder-model");
    expect(env.PAPERCLIP_LLM_INTERNAL_PROVIDER_IDS).toBe("inhouse");
  });

  it("생성된 provider JSON이 어댑터가 기대하는 모양이다", () => {
    const env = buildLaneEnv({ inHouse: { ...IN_HOUSE, providerId: "corp", npm: "@ai-sdk/openai-compatible" }, disableTelemetry: false });
    const parsed = JSON.parse(env.PAPERCLIP_OPENCODE_PROVIDERS);
    expect(parsed.corp.npm).toBe("@ai-sdk/openai-compatible");
    expect(parsed.corp.options.baseURL).toBe("https://llm.corp.internal/v1");
    expect(parsed.corp.models).toHaveProperty("my-coder-model");
  });

  it("토큰을 환경 변수 참조로 남겨 평문 노출을 피한다", () => {
    const env = buildLaneEnv({ inHouse: { ...IN_HOUSE, providerId: "corp", npm: "@ai-sdk/openai-compatible" }, disableTelemetry: false });
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS).toContain("{env:CORP_LLM_KEY}");
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS).not.toContain("sk-");
  });

  it("파일에 직접 적은 토큰도 참조로만 내보낸다", () => {
    // 개인 PC에서는 토큰을 파일에 두는 편이 편하지만, 그렇다고 생성된 설정이나
    // 실행 기록에 평문이 남아서는 안 된다.
    const env = buildLaneEnv({
      inHouse: { baseUrl: "https://x/v1", model: "m", apiKey: "sk-직접", providerId: "corp", npm: "@ai-sdk/openai-compatible" },
      disableTelemetry: false,
    });
    expect(env.PAPERCLIP_OPENCODE_PROVIDERS).not.toContain("sk-직접");
    expect(JSON.parse(env.PAPERCLIP_OPENCODE_PROVIDERS).corp.options.apiKey)
      .toBe("{env:PAPERCLIP_INHOUSE_LLM_KEY}");
    // 실제 값은 전용 변수에만 담긴다.
    expect(env.PAPERCLIP_INHOUSE_LLM_KEY).toBe("sk-직접");
  });

  it("토큰을 담은 전용 변수는 자식 프로세스로 전달되지 않는 이름을 쓴다", () => {
    // sanitizeInheritedPaperclipEnv가 PAPERCLIP_ 접두사를 자식 환경에서 제거하므로,
    // 이 이름을 쓰면 토큰이 CLI 프로세스로 새지 않는다.
    const env = buildLaneEnv({
      inHouse: { baseUrl: "https://x/v1", model: "m", apiKey: "sk-x", providerId: "corp", npm: "@ai-sdk/openai-compatible" },
      disableTelemetry: false,
    });
    const tokenVar = Object.keys(env).find((k) => env[k] === "sk-x");
    expect(tokenVar).toMatch(/^PAPERCLIP_/);
  });

  it("토큰이 아예 없으면 무엇이 빠졌는지 알려준다", () => {
    expect(() =>
      buildLaneEnv({
        inHouse: { baseUrl: "https://x/v1", model: "m", providerId: "corp", npm: "@ai-sdk/openai-compatible" },
        disableTelemetry: false,
      }),
    ).toThrow(/apiKey 또는 apiKeyEnv/);
  });

  it("Bedrock 설정은 해당 변수만 만든다", () => {
    const env = buildLaneEnv({ bedrock: { region: "ap-northeast-2" }, disableTelemetry: false });
    expect(env).toEqual({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "ap-northeast-2" });
  });

  it("두 레인을 함께 쓸 수 있다", () => {
    const env = buildLaneEnv({
      inHouse: { ...IN_HOUSE, providerId: "corp", npm: "@ai-sdk/openai-compatible" },
      bedrock: { region: "ap-northeast-2" },
      disableTelemetry: false,
    });
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
    expect(env.PAPERCLIP_OPENCODE_SMALL_MODEL).toBe("corp/my-coder-model");
  });

  it("텔레메트리 차단은 정확히 문자열 1로 넣는다", () => {
    const env = buildLaneEnv({ disableTelemetry: true });
    expect(env.PAPERCLIP_TELEMETRY_DISABLED).toBe("1");
    expect(env.DO_NOT_TRACK).toBe("1");
  });
});

describe("환경 변수 반영", () => {
  it("파일이 없으면 아무것도 하지 않는다", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(applyLlmLaneConfig(env, path.join(tmpDir, "없음.json"))).toBeNull();
    expect(env).toEqual({});
  });

  it("설정 파일 값을 환경 변수로 펼친다", () => {
    const filePath = writeConfig({ inHouse: IN_HOUSE });
    const env: NodeJS.ProcessEnv = {};
    const result = applyLlmLaneConfig(env, filePath);

    expect(result?.applied).toContain("PAPERCLIP_OPENCODE_PROVIDERS");
    expect(env.PAPERCLIP_OPENCODE_SMALL_MODEL).toBe("corp/my-coder-model");
  });

  it("이미 지정된 환경 변수는 덮어쓰지 않는다", () => {
    // 컨테이너나 systemd가 내려준 값이 언제나 파일보다 우선이어야 한다.
    const filePath = writeConfig({ inHouse: IN_HOUSE });
    const env: NodeJS.ProcessEnv = { PAPERCLIP_OPENCODE_SMALL_MODEL: "기존/값" };
    const result = applyLlmLaneConfig(env, filePath);

    expect(env.PAPERCLIP_OPENCODE_SMALL_MODEL).toBe("기존/값");
    expect(result?.skipped).toContain("PAPERCLIP_OPENCODE_SMALL_MODEL");
    expect(result?.applied).toContain("PAPERCLIP_OPENCODE_PROVIDERS");
  });

  it("빈 문자열은 지정되지 않은 것으로 보고 채운다", () => {
    const filePath = writeConfig({ inHouse: IN_HOUSE });
    const env: NodeJS.ProcessEnv = { OPENCODE_ALLOW_ALL_MODELS: "" };
    applyLlmLaneConfig(env, filePath);
    expect(env.OPENCODE_ALLOW_ALL_MODELS).toBe("true");
  });
});
