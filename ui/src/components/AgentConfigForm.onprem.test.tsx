// @vitest-environment jsdom

/**
 * 사내 배포본에서 에이전트 설정 화면이 좁아졌는지 확인한다.
 *
 * 원본 화면을 검증하는 AgentConfigForm.render.test.tsx와 나눠 둔 이유는 upstream
 * 동기화 때문이다. 원본 테스트 파일을 고치면 싱크마다 충돌이 나므로, 사내 배포본의
 * 기대치는 이 파일에만 둔다.
 */

import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentConfigForm } from "./AgentConfigForm";
import { defaultCreateValues } from "./agent-config-defaults";

const mockAgentsApi = vi.hoisted(() => ({
  adapterModelProfiles: vi.fn(),
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  list: vi.fn(),
  testEnvironment: vi.fn(),
}));

const mockLlmLanesApi = vi.hoisted(() => ({
  options: vi.fn(),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("@/api/llmLanes", () => ({ llmLanesApi: mockLlmLanesApi }));
vi.mock("../api/environments", () => ({ environmentsApi: { list: vi.fn(async () => []) } }));
vi.mock("../api/secrets", () => ({
  secretsApi: { list: vi.fn(async () => []), listUserSecretDefinitions: vi.fn(async () => []) },
}));
vi.mock("../api/instanceSettings", () => ({
  instanceSettingsApi: {
    get: vi.fn(async () => ({})),
    getExperimental: vi.fn(async () => ({ enableEnvironments: false })),
    getGeneral: vi.fn(async () => ({ executionMode: "any" })),
  },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip" },
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));
vi.mock("../adapters", () => ({
  getUIAdapter: (type: string) => ({
    type,
    label: type,
    ConfigFields: () => null,
    buildAdapterConfig: (values: { model?: string }) => ({ model: values.model || undefined }),
    parseStdoutLine: () => [],
  }),
}));
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: true,
    supportsSkills: true,
    supportsLocalAgentJwt: true,
    requiresMaterializedRuntimeSkills: false,
    supportsModelProfiles: true,
    supportsAcp: false,
  }),
}));
vi.mock("../adapters/use-disabled-adapters", () => ({ useDisabledAdaptersSync: () => [] }));
vi.mock("./MarkdownEditor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => <textarea readOnly value={value} />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

const LANES = [
  {
    name: "사내GPU-A",
    kind: "inhouse" as const,
    label: null,
    model: "coder-a",
    qualifiedModel: "corp/coder-a",
    adapterType: "opencode_local" as const,
    isDefault: true,
  },
  {
    name: "Bedrock 사내",
    kind: "bedrock" as const,
    label: null,
    model: "us.anthropic.claude-x",
    qualifiedModel: "us.anthropic.claude-x",
    adapterType: "claude_local" as const,
    isDefault: false,
  },
];

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubEnv("VITE_PAPERCLIP_AGENT_UI_MODE", "onprem");
  mockLlmLanesApi.options.mockResolvedValue(LANES);
  mockAgentsApi.adapterModels.mockResolvedValue([]);
  mockAgentsApi.adapterModelProfiles.mockResolvedValue([]);
  mockAgentsApi.detectModel.mockResolvedValue({ model: null });
  mockAgentsApi.list.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.clearAllMocks();
});

async function renderCreateForm(onChange = vi.fn()) {
  await act(() => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AgentConfigForm
              mode="create"
              values={{ ...defaultCreateValues, adapterType: "opencode_local" }}
              onChange={onChange}
            />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flushReact();
  return onChange;
}

describe("사내 배포본 에이전트 설정 화면", () => {
  it("LLM 레인 목록을 보여 준다", async () => {
    await renderCreateForm();
    expect(container.textContent).toContain("LLM");
    const select = container.querySelector("select");
    expect(select).toBeTruthy();
    const optionLabels = [...container.querySelectorAll("option")].map((node) => node.textContent);
    expect(optionLabels.some((label) => label?.includes("사내GPU-A"))).toBe(true);
    expect(optionLabels.some((label) => label?.includes("Bedrock 사내"))).toBe(true);
  });

  it("레인을 고르면 어댑터 종류와 모델이 함께 정해진다", async () => {
    const onChange = await renderCreateForm();
    const select = container.querySelector("select")!;
    await act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(select, "Bedrock 사내");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({
      llmLane: "Bedrock 사내",
      adapterType: "claude_local",
      model: "us.anthropic.claude-x",
    });
  });

  it("어댑터 종류 드롭다운은 보이지 않는다", async () => {
    await renderCreateForm();
    expect(container.textContent).not.toContain("Adapter type");
  });

  it("실행 명령·환경 변수·시크릿 접근은 보이지 않는다", async () => {
    await renderCreateForm();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Command");
    expect(text).not.toContain("Environment variables");
    expect(text).not.toContain("Secret access");
    expect(text).not.toContain("Timeout (sec)");
  });

  it("하트비트·실행 정책은 보이지 않는다", async () => {
    await renderCreateForm();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Run Policy");
    expect(text).not.toContain("Heartbeat on interval");
  });

  it("레인이 하나도 없으면 설정 화면으로 안내한다", async () => {
    mockLlmLanesApi.options.mockResolvedValue([]);
    await renderCreateForm();
    expect(container.textContent).toContain("등록된 레인이 없습니다");
  });
});
