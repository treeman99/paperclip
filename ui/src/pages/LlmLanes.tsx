/**
 * LLM 연결 설정 화면.
 *
 * 이 배포본이 붙을 수 있는 LLM은 두 가지뿐이다 — AWS Bedrock의 Claude와 사내
 * 오픈웨이트 모델. 그래서 이 화면은 "어떤 LLM을 쓸까"를 고르는 곳이 아니라,
 * 그 둘의 접속 정보를 등록하는 곳이다.
 *
 * 접속 정보 한 벌을 레인이라 부르고 이름을 붙인다. 에이전트는 레인 이름만
 * 고르므로, 토큰이 에이전트마다 복제되지 않고 모델이 바뀌어도 여기 한 곳만
 * 고치면 된다.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  llmLanesApi,
  type AwsSsoStatus,
  type LanePayload,
  type LaneSummary,
  type LaneTestResult,
} from "@/api/llmLanes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "@/context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

type DraftLane = {
  /** 편집 중이면 원래 이름. 새로 만드는 중이면 null. */
  previousName: string | null;
  name: string;
  kind: "inhouse" | "bedrock";
  baseUrl: string;
  model: string;
  providerId: string;
  apiKey: string;
  /** 토큰을 이미 저장해 둔 레인을 편집 중인지. 비워 두면 유지된다는 안내에 쓴다. */
  hasStoredKey: boolean;
  region: string;
  label: string;
};

function emptyDraft(kind: "inhouse" | "bedrock"): DraftLane {
  return {
    previousName: null,
    name: "",
    kind,
    baseUrl: "",
    model: "",
    providerId: kind === "inhouse" ? "corp" : "",
    apiKey: "",
    hasStoredKey: false,
    region: "",
    label: "",
  };
}

function draftFromLane(lane: LaneSummary): DraftLane {
  return {
    previousName: lane.name,
    name: lane.name,
    kind: lane.kind,
    baseUrl: lane.baseUrl ?? "",
    model: lane.model ?? "",
    providerId: lane.providerId ?? "corp",
    apiKey: "",
    hasStoredKey: !!lane.hasApiKey,
    region: lane.region ?? "",
    label: lane.label ?? "",
  };
}

function draftToPayload(draft: DraftLane): LanePayload {
  const shared = {
    kind: draft.kind,
    label: draft.label.trim() || null,
    model: draft.model.trim() || null,
    previousName: draft.previousName,
  };
  if (draft.kind === "bedrock") {
    return { ...shared, region: draft.region.trim() || null };
  }
  return {
    ...shared,
    baseUrl: draft.baseUrl.trim(),
    providerId: draft.providerId.trim() || "corp",
    // 비워 두면 서버가 기존 토큰을 유지한다. 편집 중이 아니면 빈 값도 그대로
    // 보내야 "토큰 없음" 오류가 제때 뜬다.
    ...(draft.apiKey.length > 0 || !draft.hasStoredKey ? { apiKey: draft.apiKey } : {}),
  };
}

/** 라벨 + 입력칸 한 줄. 이 화면에만 쓰는 배치라 별도 컴포넌트로 빼지 않는다. */
function LaneField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function TestFeedback({ result }: { result: LaneTestResult }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        result.ok
          ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {result.detail}
    </div>
  );
}

export function LlmLanes() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [draft, setDraft] = useState<DraftLane | null>(null);
  const [draftTest, setDraftTest] = useState<LaneTestResult | null>(null);
  const [laneTests, setLaneTests] = useState<Record<string, LaneTestResult>>({});
  const [deleteBlocked, setDeleteBlocked] = useState<{ name: string; agents: string[] } | null>(null);
  const [ssoProfile, setSsoProfile] = useState("");
  const [ssoRegion, setSsoRegion] = useState("");
  const [ssoTouched, setSsoTouched] = useState(false);
  const [useDeviceCode, setUseDeviceCode] = useState(false);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Instance settings" },
      { label: "LLM 연결" },
    ]);
  }, [setBreadcrumbs]);

  const settingsQuery = useQuery({
    queryKey: queryKeys.instance.llmLanes,
    queryFn: () => llmLanesApi.get(),
  });
  const settings = settingsQuery.data;

  // 저장된 값을 입력칸에 채운다. 사용자가 타이핑을 시작한 뒤에는 덮어쓰지 않는다.
  useEffect(() => {
    if (!settings || ssoTouched) return;
    setSsoProfile(settings.awsSso.profile ?? "");
    setSsoRegion(settings.awsSso.region ?? "");
  }, [settings, ssoTouched]);

  const hasBedrockLane = useMemo(
    () => (settings?.lanes ?? []).some((lane) => lane.kind === "bedrock"),
    [settings],
  );

  const ssoQuery = useQuery({
    queryKey: queryKeys.instance.awsSso,
    queryFn: () => llmLanesApi.awsSsoStatus(),
    enabled: !!settings?.awsSso.profile,
    // 로그인 진행 중에는 사용자가 브라우저에서 승인하기를 기다리는 상태라
    // 짧은 주기로 확인한다. 그 외에는 굳이 자주 물을 이유가 없다.
    refetchInterval: (query) =>
      query.state.data?.login.state === "pending" ? 3000 : false,
  });

  /**
   * 이 PC의 AWS 환경 — CLI가 있는지, `~/.aws/config`에 어떤 프로필이 있는지.
   *
   * 프로필 이름을 손으로 받아 적게 하면 오타와 "만든 적 없음"이 똑같이
   * "프로필 없음"으로 돌아와 사용자가 구분할 수 없다. 실제로 있는 이름을
   * 보여 주면 그 구분 자체가 필요 없어진다.
   */
  const awsEnvQuery = useQuery({
    queryKey: queryKeys.instance.awsEnvironment,
    queryFn: () => llmLanesApi.awsSsoEnvironment(),
    // CLI 설치 여부와 설정 파일은 화면을 보는 동안 거의 바뀌지 않는다.
    staleTime: 60_000,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.instance.llmLanes });
    await queryClient.invalidateQueries({ queryKey: queryKeys.instance.awsSso });
  };

  const saveMutation = useMutation({
    mutationFn: (value: DraftLane) => llmLanesApi.save(value.name.trim(), draftToPayload(value)),
    onSuccess: async () => {
      setDraft(null);
      setDraftTest(null);
      await invalidate();
      pushToast({ title: "레인을 저장했습니다.", tone: "success" });
    },
    onError: (error) => pushToast({ title: error instanceof Error ? error.message : "저장하지 못했습니다.", tone: "error" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (input: { name: string; force?: boolean }) =>
      llmLanesApi.remove(input.name, { force: input.force }),
    onSuccess: async () => {
      setDeleteBlocked(null);
      await invalidate();
      pushToast({ title: "레인을 삭제했습니다.", tone: "success" });
    },
    onError: (error) => pushToast({ title: error instanceof Error ? error.message : "삭제하지 못했습니다.", tone: "error" }),
  });

  /**
   * 삭제 전에 이 레인을 쓰는 에이전트가 있는지 먼저 본다.
   *
   * 서버도 같은 검사를 하지만, 거기서 막히면 사용자는 오류 문구만 보고 누가 쓰고
   * 있는지 모른다. 먼저 물어보고 이름을 보여 준 뒤 결정하게 한다.
   */
  const requestDeleteMutation = useMutation({
    mutationFn: async (name: string) => ({
      name,
      inUse: await llmLanesApi.agentsUsing(name),
    }),
    onSuccess: ({ name, inUse }) => {
      if (inUse.length === 0) {
        deleteMutation.mutate({ name });
        return;
      }
      setDeleteBlocked({ name, agents: inUse.map((agent) => agent.name) });
    },
    onError: (error) => pushToast({ title: error instanceof Error ? error.message : "확인하지 못했습니다.", tone: "error" }),
  });

  const defaultMutation = useMutation({
    mutationFn: (name: string) => llmLanesApi.makeDefault(name),
    onSuccess: invalidate,
    onError: (error) => pushToast({ title: error instanceof Error ? error.message : "바꾸지 못했습니다.", tone: "error" }),
  });

  const testMutation = useMutation({
    mutationFn: (name: string) => llmLanesApi.test(name),
    onSuccess: (result, name) => setLaneTests((prev) => ({ ...prev, [name]: result })),
    onError: (error, name) =>
      setLaneTests((prev) => ({
        ...prev,
        [name]: { ok: false, detail: error instanceof Error ? error.message : "확인하지 못했습니다." },
      })),
  });

  const draftTestMutation = useMutation({
    mutationFn: (value: DraftLane) =>
      llmLanesApi.testDraft({ ...draftToPayload(value), name: value.previousName ?? undefined }),
    onSuccess: (result) => setDraftTest(result),
    onError: (error) =>
      setDraftTest({
        ok: false,
        detail: error instanceof Error ? error.message : "확인하지 못했습니다.",
      }),
  });

  const ssoSaveMutation = useMutation({
    mutationFn: () =>
      llmLanesApi.saveAwsSso({ profile: ssoProfile.trim() || null, region: ssoRegion.trim() || null }),
    onSuccess: async () => {
      setSsoTouched(false);
      await invalidate();
      pushToast({ title: "AWS SSO 설정을 저장했습니다.", tone: "success" });
    },
    onError: (error) => pushToast({ title: error instanceof Error ? error.message : "저장하지 못했습니다.", tone: "error" }),
  });

  const ssoLoginMutation = useMutation({
    mutationFn: () => llmLanesApi.awsSsoLogin({ useDeviceCode }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.awsSso });
    },
    onError: (error) =>
      pushToast({ title: error instanceof Error ? error.message : "로그인을 시작하지 못했습니다.", tone: "error" }),
  });

  const ssoCancelMutation = useMutation({
    mutationFn: () => llmLanesApi.cancelAwsSsoLogin(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.awsSso });
    },
    onError: (error) =>
      pushToast({ title: error instanceof Error ? error.message : "중단하지 못했습니다.", tone: "error" }),
  });

  const ssoLogoutMutation = useMutation({
    mutationFn: () => llmLanesApi.awsSsoLogout(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.awsSso });
      pushToast({ title: result.message, tone: result.ok ? "success" : "error" });
    },
    onError: (error) =>
      pushToast({ title: error instanceof Error ? error.message : "로그아웃하지 못했습니다.", tone: "error" }),
  });

  if (settingsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">LLM 설정을 불러오는 중…</div>;
  }
  if (settingsQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {settingsQuery.error instanceof Error
          ? settingsQuery.error.message
          : "LLM 설정을 불러오지 못했습니다."}
      </div>
    );
  }

  const lanes = settings?.lanes ?? [];
  const sso = ssoQuery.data;
  const login = sso?.login;
  const awsEnv = awsEnvQuery.data;
  const knownProfiles = awsEnv?.profiles ?? [];
  // 입력칸에 적힌 이름이 이 PC에 실제로 있는 프로필인지. 저장하기 전에 알려 준다.
  const selectedProfile = knownProfiles.find((entry) => entry.name === ssoProfile.trim()) ?? null;
  const draftModelOptions =
    draftTest?.ok && draftTest.models && draftTest.models.length > 0 ? draftTest.models : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold">LLM 연결</h1>
        <p className="text-sm text-muted-foreground mt-1">
          이 설치본은 AWS Bedrock의 Claude와 사내 오픈웨이트 모델 두 가지만 사용합니다.
          접속 정보를 여기서 등록하면 에이전트는 이름만 골라 씁니다.
        </p>
        <p className="text-xs font-mono text-muted-foreground mt-2">{settings?.filePath}</p>
      </div>

      {/* ---- AWS SSO ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          AWS SSO 로그인
        </h2>
        <Card className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Bedrock은 이 PC의 AWS SSO 세션으로 인증합니다. 세션은 몇 시간마다 만료되므로
            만료되면 아래 버튼으로 다시 로그인하세요.
          </p>

          {/*
            CLI 여부는 프로필을 저장하기 전에 알아야 한다. 없는 상태로 프로필만
            열심히 맞춰 봐야 로그인 버튼은 어차피 실패한다.
          */}
          {awsEnv && !awsEnv.cli.available ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              AWS CLI를 실행하지 못했습니다. 터미널에서 <code>aws --version</code>이 되는데도
              이렇게 나오면, 서버를 시작한 뒤에 설치한 것입니다 — 서버를 다시 시작하세요.
              그렇지 않다면 AWS CLI v2를 먼저 설치하세요.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <LaneField label="프로필 이름" hint="~/.aws/config 의 profile 이름">
              <Input
                value={ssoProfile}
                onChange={(event) => {
                  setSsoTouched(true);
                  setSsoProfile(event.target.value);
                }}
                placeholder="corp-sso"
                className="font-mono text-sm"
                list={knownProfiles.length > 0 ? "aws-sso-profile-options" : undefined}
              />
              {knownProfiles.length > 0 ? (
                <datalist id="aws-sso-profile-options">
                  {knownProfiles.map((profile) => (
                    <option key={profile.name} value={profile.name} />
                  ))}
                </datalist>
              ) : null}
            </LaneField>
            <LaneField label="기본 리전" hint="레인이 리전을 비워 두면 이 값을 씁니다">
              <Input
                value={ssoRegion}
                onChange={(event) => {
                  setSsoTouched(true);
                  setSsoRegion(event.target.value);
                }}
                placeholder="us-west-2"
                className="font-mono text-sm"
              />
            </LaneField>
          </div>

          {knownProfiles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {knownProfiles.map((profile) => (
                <button
                  key={profile.name}
                  type="button"
                  onClick={() => {
                    setSsoTouched(true);
                    setSsoProfile(profile.name);
                    // 프로필이 리전을 알고 있으면 같이 채운다. 어차피 같은 값을
                    // 손으로 옮겨 적게 될 자리다.
                    if (profile.ssoRegion && !ssoRegion.trim()) setSsoRegion(profile.ssoRegion);
                  }}
                  className={cn(
                    "rounded-full border border-border px-2 py-0.5 font-mono text-xs transition-colors",
                    ssoProfile.trim() === profile.name
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {profile.name}
                </button>
              ))}
            </div>
          ) : awsEnv ? (
            // 아직 못 읽어 온 동안에는 아무 말도 하지 않는다. 로딩 중에 "프로필이
            // 없습니다"가 스쳐 지나가면 사실이 아닌 것을 본 셈이 된다.
            <div className="text-xs text-muted-foreground">
              {awsEnv.configPath
                ? "이 PC의 AWS 설정 파일에 SSO 프로필이 없습니다."
                : "이 PC에 AWS 설정 파일이 없습니다."}{" "}
              터미널에서 <code className="font-mono">aws configure sso --profile 이름</code>을 한 번
              실행해 만드세요. Paperclip은 이 파일을 고치지 않습니다.
            </div>
          ) : null}

          {selectedProfile ? (
            <div className="font-mono text-[11px] break-all text-muted-foreground">
              {[
                selectedProfile.startUrl,
                selectedProfile.accountId,
                selectedProfile.roleName,
                selectedProfile.ssoRegion,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => ssoSaveMutation.mutate()}
              disabled={ssoSaveMutation.isPending}
            >
              {ssoSaveMutation.isPending ? "저장 중…" : "저장"}
            </Button>
            <Button
              size="sm"
              onClick={() => ssoLoginMutation.mutate()}
              disabled={!settings?.awsSso.profile || login?.state === "pending"}
            >
              {login?.state === "pending" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 로그인 진행 중
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5" /> SSO 로그인
                </>
              )}
            </Button>
            {login?.state === "pending" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ssoCancelMutation.mutate()}
                disabled={ssoCancelMutation.isPending}
              >
                중단
              </Button>
            ) : null}
            {sso?.status.state === "logged_in" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ssoLogoutMutation.mutate()}
                disabled={ssoLogoutMutation.isPending}
              >
                <LogOut className="h-3.5 w-3.5" /> 로그아웃
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.instance.awsSso })}
              disabled={!settings?.awsSso.profile}
              title="상태 다시 확인"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            {sso ? <SsoStatusBadge status={sso.status} /> : null}
          </div>

          {/*
            기본 로그인 흐름(v2.22 이후)은 브라우저가 이 PC의 로컬 포트로 되돌아와야
            끝난다. 브라우저가 다른 기기에 있거나 사내 정책이 그 콜백을 막으면
            영원히 끝나지 않으므로, 그럴 때 쓸 수 있는 선택지를 열어 둔다.
          */}
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={useDeviceCode}
              onCheckedChange={(checked) => setUseDeviceCode(checked === true)}
              disabled={login?.state === "pending"}
              className="mt-0.5"
            />
            <span>
              장치 코드 방식으로 로그인합니다. 브라우저를 다른 기기에서 열어야 하거나,
              기본 방식이 끝까지 진행되지 않을 때 켜세요.
            </span>
          </label>

          {/* 위쪽 배너가 이미 같은 말을 하고 있으면 두 번 띄우지 않는다. */}
          {sso?.status.state === "cli_missing" && awsEnv?.cli.available !== false ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              {sso.status.message}
            </div>
          ) : null}
          {sso?.status.state === "profile_missing" ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 space-y-1">
              <div>{sso.status.message}</div>
              <div className="font-mono">{sso.status.remediation}</div>
            </div>
          ) : null}

          {login?.state === "pending" ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs space-y-1.5">
              <div className="text-muted-foreground">
                {login.usingDeviceCode
                  ? "아래 주소를 브라우저에서 열고 코드를 입력해 승인하세요."
                  : "브라우저가 자동으로 열리지 않으면 아래 주소를 여세요."}
              </div>
              {login.verificationUrl ? (
                <a
                  href={login.verificationUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                >
                  {login.verificationUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="text-muted-foreground">인증 주소를 기다리는 중…</div>
              )}
              {login.userCode ? (
                <div className="font-mono text-sm tracking-widest">{login.userCode}</div>
              ) : null}
            </div>
          ) : null}
          {login?.state === "failed" ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {login.message}
            </div>
          ) : null}
          {login?.state === "cancelled" ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              로그인을 중단했습니다.
            </div>
          ) : null}
          {login?.state === "succeeded" ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
              로그인이 끝났습니다.
            </div>
          ) : null}
          {!settings?.awsSso.profile && hasBedrockLane ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              Bedrock 레인이 있는데 SSO 프로필이 비어 있습니다. 프로필 이름을 저장하세요.
            </div>
          ) : null}
          {awsEnv?.configPath ? (
            <div className="font-mono text-[10px] break-all text-muted-foreground/70">
              {awsEnv.configPath}
            </div>
          ) : null}
        </Card>
      </section>

      {/* ---- 레인 목록 ---- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            LLM 레인
          </h2>
          {!draft ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft("bedrock"))}>
                <Plus className="h-3.5 w-3.5" /> Bedrock
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft("inhouse"))}>
                <Plus className="h-3.5 w-3.5" /> 사내 모델
              </Button>
            </div>
          ) : null}
        </div>

        {lanes.length === 0 && !draft ? (
          <Card className="p-6 text-center space-y-2">
            <Server className="h-5 w-5 mx-auto text-muted-foreground" />
            <p className="text-sm">등록된 레인이 없습니다.</p>
            <p className="text-xs text-muted-foreground">
              위 버튼으로 Bedrock 또는 사내 모델 접속 정보를 하나 만드세요. 레인이 없으면
              에이전트를 실행할 수 없습니다.
            </p>
          </Card>
        ) : null}

        <div className="space-y-2">
          {lanes.map((lane) => (
            <Card key={lane.name} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium truncate">{lane.name}</span>
                    <Badge variant="outline">
                      {lane.kind === "bedrock" ? "Bedrock Claude" : "사내 모델"}
                    </Badge>
                    {lane.isDefault ? <Badge>기본</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {lane.kind === "inhouse" ? (
                      <div className="font-mono truncate">{lane.baseUrl}</div>
                    ) : (
                      <div className="font-mono">
                        리전 {lane.effectiveRegion ?? "미지정"}
                        {!lane.region && lane.effectiveRegion ? " (SSO 기본값)" : ""}
                      </div>
                    )}
                    <div className="font-mono truncate">
                      모델 {lane.qualifiedModel ?? "미지정"}
                    </div>
                    {lane.kind === "inhouse" ? (
                      <div>
                        토큰 {lane.hasApiKey ? "저장됨" : "없음"}
                        {lane.apiKeyEnv ? ` (환경 변수 ${lane.apiKeyEnv})` : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => testMutation.mutate(lane.name)}
                    disabled={testMutation.isPending}
                    title="연결 확인"
                  >
                    {testMutation.isPending && testMutation.variables === lane.name ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  {!lane.isDefault ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => defaultMutation.mutate(lane.name)}
                      title="기본 레인으로"
                    >
                      <Star className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDraft(draftFromLane(lane));
                      setDraftTest(null);
                    }}
                    title="수정"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => requestDeleteMutation.mutate(lane.name)}
                    disabled={deleteMutation.isPending || requestDeleteMutation.isPending}
                    title="삭제"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
              {deleteBlocked?.name === lane.name ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 space-y-2">
                  <div>
                    이 레인을 쓰는 에이전트가 {deleteBlocked.agents.length}명 있습니다:{" "}
                    {deleteBlocked.agents.join(", ")}. 지우면 그 에이전트들은 다음 실행에서
                    실패합니다.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteMutation.mutate({ name: lane.name, force: true })}
                      disabled={deleteMutation.isPending}
                    >
                      그래도 삭제
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteBlocked(null)}>
                      취소
                    </Button>
                  </div>
                </div>
              ) : null}
              {laneTests[lane.name] ? <TestFeedback result={laneTests[lane.name]!} /> : null}
            </Card>
          ))}
        </div>

        {draft ? (
          <Card className="p-4 space-y-3 border-primary/40">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                {draft.previousName ? `"${draft.previousName}" 수정` : "새 레인"}
                {" · "}
                {draft.kind === "bedrock" ? "Bedrock Claude" : "사내 모델"}
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  setDraftTest(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>

            <LaneField label="레인 이름" hint="에이전트 화면에 이 이름으로 보입니다">
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={draft.kind === "bedrock" ? "Bedrock 사내" : "사내GPU-A"}
                className="text-sm"
              />
            </LaneField>

            {draft.kind === "inhouse" ? (
              <>
                <LaneField label="서버 주소" hint="끝에 /v1 까지 포함">
                  <Input
                    value={draft.baseUrl}
                    onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                    placeholder="https://llm.corp.internal/v1"
                    className="font-mono text-sm"
                  />
                </LaneField>
                <LaneField
                  label="토큰"
                  hint={draft.hasStoredKey ? "비워 두면 기존 토큰을 유지합니다" : undefined}
                >
                  <Input
                    type="password"
                    value={draft.apiKey}
                    onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                    placeholder={draft.hasStoredKey ? "••••••••" : "sk-…"}
                    className="font-mono text-sm"
                    autoComplete="off"
                  />
                </LaneField>
                <LaneField label="모델 이름" hint="서버가 서빙 중인 이름 그대로">
                  <Input
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                    placeholder="qwen3-coder-30b"
                    className="font-mono text-sm"
                    list={draftModelOptions ? "llm-lane-model-options" : undefined}
                  />
                  {draftModelOptions ? (
                    <datalist id="llm-lane-model-options">
                      {draftModelOptions.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  ) : null}
                </LaneField>
                {draftModelOptions ? (
                  <div className="flex flex-wrap gap-1.5">
                    {draftModelOptions.slice(0, 12).map((model) => (
                      <button
                        key={model}
                        type="button"
                        onClick={() => setDraft({ ...draft, model })}
                        className={cn(
                          "rounded-full border border-border px-2 py-0.5 font-mono text-xs transition-colors",
                          draft.model === model
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50",
                        )}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                ) : null}
                <LaneField
                  label="provider 이름"
                  hint="모델 앞에 붙습니다. 레인마다 달라야 합니다"
                >
                  <Input
                    value={draft.providerId}
                    onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
                    placeholder="corp"
                    className="font-mono text-sm"
                  />
                </LaneField>
              </>
            ) : (
              <>
                <LaneField label="리전" hint="비우면 위의 기본 리전을 씁니다">
                  <Input
                    value={draft.region}
                    onChange={(event) => setDraft({ ...draft, region: event.target.value })}
                    placeholder="us-west-2"
                    className="font-mono text-sm"
                  />
                </LaneField>
                <LaneField label="모델 id" hint="리전이 앞에 붙은 Bedrock id 또는 ARN">
                  <Input
                    value={draft.model}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                    placeholder="us.anthropic.claude-sonnet-4-5-20250929-v1:0"
                    className="font-mono text-sm"
                  />
                </LaneField>
              </>
            )}

            {draftTest ? <TestFeedback result={draftTest} /> : null}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => saveMutation.mutate(draft)}
                disabled={!draft.name.trim() || saveMutation.isPending}
              >
                {saveMutation.isPending ? "저장 중…" : "저장"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => draftTestMutation.mutate(draft)}
                disabled={draftTestMutation.isPending}
              >
                {draftTestMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 확인 중…
                  </>
                ) : (
                  "연결 확인"
                )}
              </Button>
              {draft.kind === "inhouse" ? (
                <span className="text-xs text-muted-foreground">
                  연결 확인을 누르면 서버가 서빙 중인 모델 목록을 가져옵니다.
                </span>
              ) : null}
            </div>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

/**
 * 세션이 언제 끊기는지. 몇 시간마다 만료되는 배포라 "남은 시간"이 실제로
 * 필요한 정보다. 이미 지난 값은 보여 주지 않는다 — 자격증명은 방금 통과했는데
 * 캐시가 낡아 있는 경우이고, 그때 만료를 띄우면 서로 모순되어 보인다.
 */
function formatExpiry(expiresAt: string): string | null {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return null;
  return parsed.toLocaleString();
}

function SsoStatusBadge({ status }: { status: AwsSsoStatus }) {
  if (status.state === "logged_in") {
    const expiry = status.expiresAt ? formatExpiry(status.expiresAt) : null;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <Check className="h-3.5 w-3.5" />
        로그인됨{status.accountId ? ` · 계정 ${status.accountId}` : ""}
        {expiry ? ` · ${expiry}까지` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleAlert className="h-3.5 w-3.5" />
      {status.state === "cli_missing"
        ? "AWS CLI 없음"
        : status.state === "profile_missing"
          ? "프로필 없음"
          : "로그인 필요"}
    </span>
  );
}
