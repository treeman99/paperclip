/**
 * LLM 연결 설정 화면의 API.
 *
 * 이 배포본에서 에이전트가 고를 수 있는 것은 레인 이름 하나뿐이고, URL·토큰·리전은
 * 전부 여기서 관리한다. 그래서 이 라우터가 사실상 유일한 LLM 설정 창구다.
 *
 * 인스턴스 관리자만 쓸 수 있다. 토큰이 오가는 경로이므로 회사 단위 권한으로는
 * 부족하다 — 설정 파일은 설치본 전체가 공유한다.
 */

import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable } from "@paperclipai/db";
import { forbidden, unprocessable } from "../errors.js";
import {
  deleteLane,
  getLlmLaneSettings,
  saveAwsSso,
  saveLane,
  setDefaultLane,
  testLaneByName,
  testLaneInput,
  type LaneInput,
} from "../adapters/llm-lane-service.js";
import {
  assertValidProfileName,
  cancelAwsSsoLogin,
  detectAwsCli,
  getAwsSsoStatus,
  logoutAwsSso,
  readLoginState,
  startAwsSsoLogin,
} from "../adapters/aws-sso.js";
import { readAwsSsoProfiles } from "../adapters/aws-config-profiles.js";
import { readAgentLaneName } from "../adapters/agent-lane.js";
import { assertBoardOrgAccess } from "./authz.js";

function assertCanManageLlmLanes(req: Request) {
  if (req.actor.type !== "board") throw forbidden("Board access required");
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  throw forbidden("Instance admin access required");
}

function asLaneInput(body: unknown): LaneInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const kind = raw.kind === "bedrock" ? "bedrock" : "inhouse";
  const readString = (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : undefined);
  return {
    kind,
    label: readString("label") ?? null,
    model: readString("model") ?? null,
    baseUrl: readString("baseUrl"),
    providerId: readString("providerId"),
    // apiKey는 undefined와 빈 문자열의 뜻이 다르다(유지 / 삭제). 그대로 넘긴다.
    apiKey: typeof raw.apiKey === "string" ? (raw.apiKey as string) : undefined,
    apiKeyEnv: raw.apiKeyEnv === null ? null : readString("apiKeyEnv"),
    npm: readString("npm"),
    region: readString("region") ?? null,
    profile: readString("profile") ?? null,
  };
}

/** 어떤 에이전트가 이 레인을 쓰고 있는지. 삭제·이름변경 전에 확인한다. */
async function findAgentsUsingLane(db: Db, laneName: string) {
  const rows = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      adapterConfig: agentsTable.adapterConfig,
    })
    .from(agentsTable);
  return rows
    .filter((row) => readAgentLaneName(row.adapterConfig) === laneName)
    .map((row) => ({ id: row.id, name: row.name }));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function llmLaneRoutes(db: Db) {
  const router = Router();

  router.get("/instance/llm-lanes", async (req, res) => {
    assertCanManageLlmLanes(req);
    res.json(getLlmLaneSettings());
  });

  /**
   * 에이전트 설정 화면이 쓰는 목록. 이름과 어떤 모델로 도는지만 담는다.
   *
   * 관리 화면과 나눈 이유는 권한이다 — 에이전트를 편집하는 사람이 모두 인스턴스
   * 관리자는 아니고, 레인을 고르는 데 서버 주소나 설정 파일 경로까지 필요하지는
   * 않다.
   */
  router.get("/instance/llm-lane-options", async (req, res) => {
    assertBoardOrgAccess(req);
    const settings = getLlmLaneSettings();
    res.json(
      settings.lanes.map((lane) => ({
        name: lane.name,
        kind: lane.kind,
        label: lane.label,
        model: lane.model,
        qualifiedModel: lane.qualifiedModel,
        adapterType: lane.adapterType,
        isDefault: lane.isDefault,
      })),
    );
  });

  router.put("/instance/llm-lanes/:name", async (req, res) => {
    assertCanManageLlmLanes(req);
    // express가 이미 경로 파라미터를 디코딩하므로 여기서 또 하면 이름에 든
    // 퍼센트 기호가 깨진다.
    const name = req.params.name;
    const previousName =
      typeof req.body?.previousName === "string" ? (req.body.previousName as string) : null;
    try {
      res.json(saveLane(name, asLaneInput(req.body), { previousName }));
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  router.delete("/instance/llm-lanes/:name", async (req, res) => {
    assertCanManageLlmLanes(req);
    const name = req.params.name;
    const inUse = await findAgentsUsingLane(db, name);
    if (inUse.length > 0 && req.query.force !== "true") {
      throw unprocessable(
        `이 레인을 쓰는 에이전트가 ${inUse.length}명 있습니다: ` +
          `${inUse.map((agent) => agent.name).join(", ")}. ` +
          "먼저 다른 레인으로 옮기거나 강제 삭제를 선택하세요.",
      );
    }
    try {
      res.json(deleteLane(name));
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  router.post("/instance/llm-lanes/:name/default", async (req, res) => {
    assertCanManageLlmLanes(req);
    try {
      res.json(setDefaultLane(req.params.name));
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  /** 저장된 레인 테스트. */
  router.post("/instance/llm-lanes/:name/test", async (req, res) => {
    assertCanManageLlmLanes(req);
    res.json(await testLaneByName(req.params.name));
  });

  /** 저장 전 입력값 테스트. 화면에서 값을 넣어 보고 확인할 때 쓴다. */
  router.post("/instance/llm-lanes-test", async (req, res) => {
    assertCanManageLlmLanes(req);
    const name = typeof req.body?.name === "string" ? (req.body.name as string) : undefined;
    res.json(await testLaneInput({ ...asLaneInput(req.body), name }));
  });

  /** 어떤 에이전트가 이 레인을 쓰는지 — 삭제 전 확인용. */
  router.get("/instance/llm-lanes/:name/agents", async (req, res) => {
    assertCanManageLlmLanes(req);
    res.json(await findAgentsUsingLane(db, req.params.name));
  });

  router.put("/instance/aws-sso", async (req, res) => {
    assertCanManageLlmLanes(req);
    const profile = typeof req.body?.profile === "string" ? (req.body.profile as string) : null;
    const region = typeof req.body?.region === "string" ? (req.body.region as string) : null;
    try {
      // 저장 시점에 이름 모양을 본다. 로그인 버튼을 누를 때까지 미루면 사용자는
      // 저장에 성공했다고 믿은 뒤에야 쓸 수 없는 이름이라는 것을 알게 된다.
      if (profile?.trim()) assertValidProfileName(profile.trim());
      res.json(saveAwsSso({ profile, region }));
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  /**
   * 이 PC의 AWS 환경. 자주 바뀌지 않으므로 상태 조회와 분리했다 — 상태 쪽은
   * 로그인 중 몇 초마다 호출되는데, 거기에 CLI 실행을 하나 더 얹으면 승인만
   * 기다리는 동안 프로세스를 계속 띄우게 된다.
   */
  router.get("/instance/aws-sso/environment", async (req, res) => {
    assertCanManageLlmLanes(req);
    const { configPath, profiles } = readAwsSsoProfiles();
    res.json({ cli: await detectAwsCli(), configPath, profiles });
  });

  router.get("/instance/aws-sso/status", async (req, res) => {
    assertCanManageLlmLanes(req);
    const settings = getLlmLaneSettings();
    const login = readLoginState();
    if (!settings.awsSso.profile) {
      res.json({
        status: { state: "logged_out", message: "AWS SSO 프로필이 설정되지 않았습니다." },
        login,
      });
      return;
    }
    // 로그인이 진행 중이면 자격증명을 물어봐야 답은 "아직"이다. 3초마다 CLI를
    // 띄워 같은 답을 받을 이유가 없다.
    if (login.state === "pending") {
      res.json({
        status: {
          state: "logged_out",
          message: "브라우저에서 승인이 끝나기를 기다리는 중입니다.",
        },
        login,
      });
      return;
    }
    try {
      res.json({ status: await getAwsSsoStatus(settings.awsSso.profile), login });
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  router.post("/instance/aws-sso/login", async (req, res) => {
    assertCanManageLlmLanes(req);
    const settings = getLlmLaneSettings();
    if (!settings.awsSso.profile) {
      throw unprocessable("먼저 AWS SSO 프로필 이름을 저장하세요.");
    }
    try {
      res.json(
        startAwsSsoLogin(settings.awsSso.profile, {
          useDeviceCode: req.body?.useDeviceCode === true,
        }),
      );
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  router.delete("/instance/aws-sso/login", async (req, res) => {
    assertCanManageLlmLanes(req);
    res.json(cancelAwsSsoLogin());
  });

  router.post("/instance/aws-sso/logout", async (req, res) => {
    assertCanManageLlmLanes(req);
    const settings = getLlmLaneSettings();
    if (!settings.awsSso.profile) {
      throw unprocessable("AWS SSO 프로필이 설정되지 않았습니다.");
    }
    try {
      res.json(await logoutAwsSso(settings.awsSso.profile));
    } catch (error) {
      throw unprocessable(toMessage(error));
    }
  });

  return router;
}
