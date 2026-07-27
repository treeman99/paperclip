/**
 * 에이전트 ↔ 레인 연결 검증.
 *
 * 핵심은 "설정 화면에서 모델을 바꾸면 에이전트를 다시 저장하지 않아도 반영된다"이다.
 * 사내 모델이 그때그때 바뀌는 배포 조건에서 이게 안 되면, 모델이 바뀔 때마다
 * 에이전트를 전부 손봐야 한다.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyLaneToAgentInput,
  applyLaneToRuntimeConfig,
  readAgentLaneName,
  resolveAgentLane,
} from "../adapters/agent-lane.js";

let tmpDir: string;
let configPath: string;

function write(value: unknown) {
  fs.writeFileSync(configPath, JSON.stringify(value, null, 2));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-agent-lane-"));
  configPath = path.join(tmpDir, "llm-lanes.json");
  write({
    lanes: {
      "사내GPU-A": {
        kind: "inhouse",
        baseUrl: "https://a.corp.internal/v1",
        model: "coder-a",
        apiKey: "sk-a",
        providerId: "corp",
      },
      "Bedrock 사내": {
        kind: "bedrock",
        region: "us-east-1",
        model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      },
    },
    defaultLane: "사내GPU-A",
    awsSso: { profile: "corp-sso", region: "us-west-2" },
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("레인 이름 읽기", () => {
  it("빈 문자열이나 공백은 고르지 않은 것으로 본다", () => {
    expect(readAgentLaneName({ llmLane: "   " })).toBeNull();
    expect(readAgentLaneName({})).toBeNull();
    expect(readAgentLaneName(null)).toBeNull();
  });

  it("이름을 고르지 않았으면 기본 레인으로 넘어간다", () => {
    expect(resolveAgentLane({}, configPath)?.name).toBe("사내GPU-A");
  });

  it("설정 파일이 깨져도 예외 대신 null을 준다", () => {
    fs.writeFileSync(configPath, "{ 깨진 JSON");
    expect(resolveAgentLane({ llmLane: "사내GPU-A" }, configPath)).toBeNull();
  });
});

describe("저장할 값 맞추기", () => {
  it("어댑터 종류와 모델을 레인에서 가져온다", () => {
    const result = applyLaneToAgentInput(
      { adapterType: "claude_local", adapterConfig: { llmLane: "사내GPU-A" } },
      configPath,
    );
    expect(result.adapterType).toBe("opencode_local");
    expect(result.adapterConfig?.model).toBe("corp/coder-a");
  });

  it("레인을 고르지 않은 에이전트는 건드리지 않는다", () => {
    const input = { adapterType: "claude_local", adapterConfig: { model: "us.anthropic.x" } };
    expect(applyLaneToAgentInput(input, configPath)).toEqual({
      adapterType: "claude_local",
      adapterConfig: { model: "us.anthropic.x" },
    });
  });

  it("없는 레인을 고르면 무엇이 없는지 알려주며 실패한다", () => {
    expect(() =>
      applyLaneToAgentInput({ adapterType: "claude_local", adapterConfig: { llmLane: "없음" } }, configPath),
    ).toThrow(/없음/);
  });
});

describe("실행 직전 반영", () => {
  it("설정 파일의 현재 모델로 덮어쓴다", () => {
    // 에이전트에는 예전 모델이 저장돼 있고, 설정 화면에서 모델이 바뀐 상황.
    write({
      lanes: {
        "사내GPU-A": {
          kind: "inhouse",
          baseUrl: "https://a.corp.internal/v1",
          model: "coder-b",
          apiKey: "sk-a",
          providerId: "corp",
        },
      },
    });
    const next = applyLaneToRuntimeConfig({ llmLane: "사내GPU-A", model: "corp/coder-a" }, configPath);
    expect(next.model).toBe("corp/coder-b");
  });

  it("Bedrock 레인은 리전을 실행 환경에 고정한다", () => {
    const next = applyLaneToRuntimeConfig(
      { llmLane: "Bedrock 사내", env: { EXISTING: "1", AWS_REGION: "ap-northeast-2" } },
      configPath,
    );
    expect(next.env).toEqual({
      EXISTING: "1",
      AWS_REGION: "us-east-1",
      AWS_PROFILE: "corp-sso",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
  });

  it("원본 객체를 바꾸지 않는다", () => {
    const original = { llmLane: "사내GPU-A", model: "예전" };
    applyLaneToRuntimeConfig(original, configPath);
    expect(original.model).toBe("예전");
  });

  it("설정 파일이 없으면 아무것도 바꾸지 않는다", () => {
    fs.rmSync(configPath);
    const config = { llmLane: "사내GPU-A", model: "그대로" };
    expect(applyLaneToRuntimeConfig(config, configPath)).toEqual(config);
  });

  it("레인을 고르지 않은 에이전트는 기본 레인으로 끌려가지 않는다", () => {
    // 레인 개념이 생기기 전에 만들어진 에이전트. 기본 레인이 있다고 해서
    // 이 에이전트의 모델이 어느 날 조용히 바뀌어서는 안 된다.
    const config = { model: "us.anthropic.claude-예전" };
    expect(applyLaneToRuntimeConfig(config, configPath)).toEqual(config);
  });
});
