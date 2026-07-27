/**
 * 에이전트가 쓸 LLM 레인을 고르는 칸.
 *
 * 이 배포본에서 에이전트가 LLM에 대해 정하는 것은 이것뿐이다. 어댑터 종류와
 * 모델 id는 레인에서 파생되므로 화면에는 결과만 보여 준다 — 따로 고를 수 있게
 * 두면 레인과 어긋난 조합이 만들어지고, 서버가 저장을 거부한다.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { llmLanesApi, type LaneOption } from "@/api/llmLanes";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const LANE_SETTINGS_PATH = "/company/settings/instance/llm";

export interface AgentLaneSelection {
  laneName: string;
  adapterType: "claude_local" | "opencode_local";
  /** 레인이 모델을 지정하지 않았으면 null (Bedrock 레인에서 가능). */
  model: string | null;
}

export function useLaneOptions() {
  return useQuery({
    queryKey: queryKeys.instance.llmLaneOptions,
    queryFn: () => llmLanesApi.options(),
    retry: false,
  });
}

/** 레인 이름으로 저장에 필요한 값 한 벌을 만든다. */
export function toLaneSelection(lane: LaneOption): AgentLaneSelection {
  return {
    laneName: lane.name,
    adapterType: lane.adapterType,
    model: lane.qualifiedModel,
  };
}

const selectClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm";

export function AgentLaneField({
  value,
  onChange,
  className,
  autoSelectDefault = false,
}: {
  value: string | null;
  onChange: (selection: AgentLaneSelection) => void;
  className?: string;
  /**
   * 비어 있을 때 기본 레인을 알아서 고른다. 새 에이전트를 만들 때만 켠다 —
   * 수정 화면에서 켜면 레인 없이 만들어진 기존 에이전트의 LLM이 화면을 여는
   * 것만으로 바뀐다.
   */
  autoSelectDefault?: boolean;
}) {
  const { data: lanes = [], isLoading, error } = useLaneOptions();
  const selected = lanes.find((lane) => lane.name === value) ?? null;

  useEffect(() => {
    if (!autoSelectDefault || value || lanes.length === 0) return;
    const fallback = lanes.find((lane) => lane.isDefault) ?? lanes[0]!;
    onChange(toLaneSelection(fallback));
    // onChange는 부모가 매 렌더 새로 만들 수 있어 의존성에서 뺀다. 값이 채워지면
    // 위의 early return이 재실행을 막는다.
  }, [autoSelectDefault, value, lanes]); // eslint-disable-line react-hooks/exhaustive-deps

  // 저장된 레인이 삭제된 경우. 값을 조용히 바꾸지 않고 그대로 보여 주며 알린다 —
  // 사용자가 모르는 사이에 다른 LLM으로 갈아타는 것이 더 나쁘다.
  const missing = !!value && !selected;

  return (
    <div className={cn("space-y-2", className)}>
      <select
        className={selectClass}
        value={value ?? ""}
        disabled={isLoading || lanes.length === 0}
        onChange={(event) => {
          const next = lanes.find((lane) => lane.name === event.target.value);
          if (next) onChange(toLaneSelection(next));
        }}
      >
        {!value ? <option value="">레인을 고르세요</option> : null}
        {missing ? <option value={value ?? ""}>{value} (삭제된 레인)</option> : null}
        {lanes.map((lane) => (
          <option key={lane.name} value={lane.name}>
            {lane.name}
            {lane.kind === "bedrock" ? " · Bedrock Claude" : " · 사내 모델"}
            {lane.isDefault ? " · 기본" : ""}
          </option>
        ))}
      </select>

      {selected ? (
        <p className="text-xs text-muted-foreground font-mono">
          {selected.qualifiedModel ?? "모델 미지정 (Bedrock 기본값)"}
        </p>
      ) : null}

      {missing ? (
        <p className="text-xs text-destructive">
          이 에이전트가 쓰던 레인이 더 이상 없습니다. 다른 레인을 고르세요.
        </p>
      ) : null}

      {!isLoading && lanes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          등록된 레인이 없습니다.{" "}
          {/* 라우터 컨텍스트 없이도 뜨는 안내라 평범한 링크를 쓴다. 이 칸은
              에이전트 생성/수정 화면 어디에나 끼어들 수 있고, 여기서 라우터를
              요구하면 그런 화면 하나가 통째로 깨진다. */}
          <a href={LANE_SETTINGS_PATH} className="text-primary hover:underline">
            LLM 연결 설정
          </a>
          에서 먼저 하나 만드세요.
        </p>
      ) : null}

      {error ? (
        <p className="text-xs text-destructive">
          {error instanceof Error ? error.message : "레인 목록을 불러오지 못했습니다."}
        </p>
      ) : null}
    </div>
  );
}
