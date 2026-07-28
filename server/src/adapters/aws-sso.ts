/**
 * AWS SSO 로그인 실행기.
 *
 * Bedrock 레인은 정적 액세스 키를 쓰지 않고 SSO 세션에 기댄다. 세션은 몇 시간마다
 * 만료되므로 그때마다 사용자가 터미널을 열어 `aws sso login`을 치게 하면 설치본을
 * 쓰기 어렵다. 그래서 화면의 버튼이 이 모듈을 통해 AWS CLI를 대신 실행하고,
 * CLI가 출력하는 인증 URL과 코드를 화면으로 되돌려 준다.
 *
 * 프로필은 PC 하나에 하나라는 전제이므로 로그인 세션도 하나만 둔다. 모듈 수준
 * 상태를 쓰는 것은 그래서다 — 개인 PC에 서버 프로세스 하나가 도는 배포 형태다.
 *
 * AWS 설정 파일(~/.aws/config)은 건드리지 않는다. 프로필이 없으면 만들어 주는
 * 대신, 사용자가 직접 실행할 명령을 알려 준다. 사내 SSO 설정은 조직마다 다르고,
 * 이미 있는 프로필을 덮어써 다른 작업을 망가뜨리는 쪽이 훨씬 나쁘다.
 *
 * 토큰은 우리가 저장하지 않는다. `aws sso login`이 자기 캐시에 넣고, 에이전트가
 * 실행될 때 AWS 자격증명 체인이 거기서 집어 간다. 이 모듈이 캐시에서 읽는 것은
 * 만료 시각뿐이다.
 */

import { spawn } from "node:child_process";
import { awsSpawnTarget, buildAwsEnv, resolveAwsCommand } from "./aws-cli.js";
import { readAwsSsoProfiles, type AwsSsoProfile } from "./aws-config-profiles.js";
import { readAwsSsoTokenExpiries } from "./aws-sso-cache.js";

/**
 * 프로필 이름은 그대로 명령 인자로 들어가므로 모양을 좁게 제한한다.
 *
 * 첫 글자에 `-`를 막는 것이 핵심이다. `--profile` 같은 이름을 허용하면 AWS CLI가
 * 그것을 값이 아니라 또 하나의 플래그로 읽는다.
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/;

const CLI_MISSING_MESSAGE =
  "AWS CLI를 찾지 못했습니다. AWS CLI v2를 설치한 뒤 서버를 다시 시작하세요.";

export function assertValidProfileName(profile: string): void {
  if (!PROFILE_NAME_RE.test(profile)) {
    throw new Error(
      `AWS 프로필 이름 "${profile}"을 쓸 수 없습니다. 영문·숫자와 . _ - 만 쓸 수 있습니다.`,
    );
  }
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** AWS CLI 자체를 찾지 못한 경우. */
  missing: boolean;
}

function runAws(args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const env = buildAwsEnv();
    const invocation = awsSpawnTarget(resolveAwsCommand(env), args);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.command, invocation.args, {
        windowsHide: true,
        env,
        // CLI가 우리 stdin을 물려받으면 입력을 기다리다 멈출 수 있다.
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      finish({ code: null, stdout: "", stderr: "", missing: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, missing: error.code === "ENOENT" });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr: `${stderr}\n시간이 초과되었습니다.`, missing: false });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, missing: false });
    });
  });
}

export interface AwsCliAvailability {
  available: boolean;
  version: string | null;
  /** 실제로 실행하기로 결정한 경로. 화면에서 원인을 짚는 데 쓴다. */
  command: string;
}

/**
 * AWS CLI가 실행 가능한지.
 *
 * 20초를 주는 이유는 v2가 PyInstaller로 묶인 단일 실행 파일이라, 사내 백신이
 * 검사하는 첫 실행이 10초를 넘기는 일이 흔하기 때문이다. 짧게 잡으면 멀쩡히
 * 설치된 PC에 "설치 안 됨"이 뜬다.
 */
export async function detectAwsCli(): Promise<AwsCliAvailability> {
  // 래퍼(cmd.exe)가 아니라 우리가 찾아낸 AWS CLI 경로를 보고한다 — 사용자가
  // 화면에서 확인해야 하는 것은 "어느 aws를 쓰고 있나"이다.
  const command = resolveAwsCommand(buildAwsEnv());
  const result = await runAws(["--version"], 20_000);
  if (result.missing || result.code !== 0) {
    return { available: false, version: null, command };
  }
  // v2는 stdout, v1은 stderr에 찍는다.
  const output = `${result.stdout} ${result.stderr}`.trim();
  return { available: true, version: output.match(/aws-cli\/(\S+)/)?.[1] ?? null, command };
}

export type AwsSsoStatus =
  | { state: "cli_missing"; message: string }
  | { state: "profile_missing"; message: string; remediation: string }
  | { state: "logged_out"; message: string }
  | {
      state: "logged_in";
      accountId: string | null;
      arn: string | null;
      /** 캐시에 남은 만료 시각(ISO). 알 수 없으면 null. */
      expiresAt: string | null;
    };

/** 이 PC에 설정된 프로필 중 이름이 같은 것. 포털 주소를 알아야 만료 시각을 찾는다. */
function findConfiguredProfile(profile: string): AwsSsoProfile | null {
  return readAwsSsoProfiles().profiles.find((entry) => entry.name === profile) ?? null;
}

function sessionExpiryFor(profile: string): string | null {
  const configured = findConfiguredProfile(profile);
  if (!configured) return null;
  return readAwsSsoTokenExpiries().get(configured.startUrl) ?? null;
}

/**
 * 현재 세션이 살아 있는지 확인한다.
 *
 * `sts get-caller-identity`를 쓰는 이유는 SSO 캐시 파일을 직접 읽는 것보다 정확해서다.
 * 캐시에 만료 시각이 남아 있어도 토큰이 철회되었을 수 있고, 캐시 파일 형식은
 * AWS CLI 버전에 따라 달라진다. 실제로 자격증명을 써 보는 것이 유일하게 믿을 만하다.
 *
 * 대신 "언제까지 유효한가"는 그 호출로 알 수 없으므로, 살아 있다고 판정된 뒤에만
 * 캐시에서 만료 시각을 덧붙인다.
 */
export async function getAwsSsoStatus(profile: string): Promise<AwsSsoStatus> {
  assertValidProfileName(profile);
  const result = await runAws(
    ["sts", "get-caller-identity", "--profile", profile, "--output", "json"],
    20_000,
  );
  if (result.missing) {
    return { state: "cli_missing", message: CLI_MISSING_MESSAGE };
  }
  if (result.code === 0) {
    const expiresAt = sessionExpiryFor(profile);
    try {
      const parsed = JSON.parse(result.stdout) as { Account?: string; Arn?: string };
      return {
        state: "logged_in",
        accountId: parsed.Account ?? null,
        arn: parsed.Arn ?? null,
        expiresAt,
      };
    } catch {
      return { state: "logged_in", accountId: null, arn: null, expiresAt };
    }
  }
  const detail = `${result.stderr}\n${result.stdout}`;
  if (/could not be found|does not exist/i.test(detail)) {
    return {
      state: "profile_missing",
      message: `AWS 프로필 "${profile}"이 이 PC에 없습니다.`,
      remediation: `터미널에서 다음을 한 번 실행해 프로필을 만드세요: aws configure sso --profile ${profile}`,
    };
  }
  return {
    state: "logged_out",
    message: detail.trim().split("\n").slice(-3).join(" ").trim() || "로그인이 필요합니다.",
  };
}

export type AwsSsoLoginState =
  | { state: "idle" }
  | {
      state: "pending";
      profile: string;
      verificationUrl: string | null;
      userCode: string | null;
      usingDeviceCode: boolean;
      output: string;
    }
  | { state: "succeeded"; profile: string; output: string }
  | { state: "cancelled"; profile: string }
  | { state: "failed"; profile: string; output: string; message: string };

interface LoginSession {
  profile: string;
  child: ReturnType<typeof spawn> | null;
  output: string;
  verificationUrl: string | null;
  userCode: string | null;
  usingDeviceCode: boolean;
  state: "pending" | "succeeded" | "failed" | "cancelled";
  message: string;
}

let session: LoginSession | null = null;

/**
 * ANSI 제어열 제거. CLI가 색을 넣으면 주소 한가운데에 이스케이프가 끼어들어
 * 그대로는 주소로 쓸 수 없는 문자열이 된다.
 */
const ANSI_RE = /\u001b\[[0-?]*[ -\/]*[@-~]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

// 코드 앞에 오는 안내 문구. 문구가 버전마다 조금씩 달라 "code" 주변만 잡는다.
const USER_CODE_RE = /enter the code:?\s*([A-Za-z0-9]{4}-[A-Za-z0-9]{4})/i;
// 안내 문구를 못 잡았을 때: 인증 주소 자체에 코드가 실려 오는 형태가 있다.
const USER_CODE_IN_URL_RE = /user_code=([A-Za-z0-9]{4}-[A-Za-z0-9]{4})/i;
// CLI가 명시적으로 "이 주소를 열어라"라고 찍는 자리. 가장 믿을 만하다.
const FOLLOWING_URL_RE = /open the following url:?\s*(https:\/\/\S+)/i;
// 문구를 못 잡았을 때: AWS 로그인 엔드포인트 모양이면 받는다.
const SSO_URL_RE = /(https:\/\/\S*(?:device\.sso|oidc|awsapps)\S*)/i;
// 주소 끝에 붙은 것은 문장 부호이지 주소의 일부가 아니다.
const TRAILING_PUNCTUATION_RE = /[.,;:)\]}'"]+$/;

/**
 * CLI 출력에서 인증 URL과 코드를 뽑는다.
 *
 * AWS CLI는 브라우저를 자동으로 열지만 사내 PC에서는 실패하는 경우가 있고,
 * 서버에 설치한 경우에는 애초에 열 브라우저가 없다. 그래서 같은 출력에 담긴
 * 주소와 코드를 화면에도 띄운다.
 *
 * 흐름이 둘이고 어느 쪽이 도는지는 CLI 버전에 달렸다.
 *
 *   device code (옛 CLI 또는 --use-device-code)
 *     ... open the following URL:
 *     https://device.sso.ap-northeast-2.amazonaws.com/
 *     Then enter the code:
 *     ABCD-EFGH
 *
 *   authorization code + PKCE (v2.22 이후 기본값)
 *     ... open the following URL:
 *     https://oidc.ap-northeast-2.amazonaws.com/authorize?response_type=code&...
 *
 * 즉 코드는 안 나올 수 있고 주소는 거의 항상 나온다. 기본 흐름의 주소는
 * `device`도 `verify`도 아니므로 그 두 단어로만 찾으면 조용히 놓친다.
 */
export function scrapeVerification(output: string): { url: string | null; code: string | null } {
  const cleaned = stripAnsi(output);
  const following = cleaned.match(FOLLOWING_URL_RE);
  const fallback = following ? null : cleaned.match(SSO_URL_RE);
  const rawUrl = following?.[1] ?? fallback?.[1] ?? null;
  const code = cleaned.match(USER_CODE_RE)?.[1] ?? cleaned.match(USER_CODE_IN_URL_RE)?.[1] ?? null;
  return {
    url: rawUrl ? rawUrl.replace(TRAILING_PUNCTUATION_RE, "") : null,
    code: code ? code.toUpperCase() : null,
  };
}

export interface StartLoginOptions {
  /**
   * 장치 코드 흐름을 강제한다.
   *
   * v2.22부터 기본값이 authorization code + PKCE로 바뀌었는데, 그 흐름은 브라우저가
   * 이 PC의 로컬 포트로 되돌아와야 완료된다. 브라우저가 다른 기기에 있거나(우분투
   * 서버 설치), 사내 정책이 로컬 콜백을 막으면 끝나지 않는다. 장치 코드 흐름은
   * 되돌아올 필요가 없다.
   */
  useDeviceCode?: boolean;
}

/**
 * 로그인을 시작한다. 이미 진행 중이면 그 세션을 그대로 돌려준다 — 버튼을 두 번
 * 눌렀다고 CLI 프로세스가 둘이 되면 둘 다 같은 SSO 캐시를 쓰다 서로를 방해한다.
 */
export function startAwsSsoLogin(
  profile: string,
  options: StartLoginOptions = {},
): AwsSsoLoginState {
  assertValidProfileName(profile);
  if (session?.state === "pending") return readLoginState();

  const useDeviceCode = options.useDeviceCode === true;
  const args = ["sso", "login", "--profile", profile];
  if (useDeviceCode) args.push("--use-device-code");

  const env = buildAwsEnv();
  const invocation = awsSpawnTarget(resolveAwsCommand(env), args);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(invocation.command, invocation.args, {
      windowsHide: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Windows에서는 실행 파일이 없으면 spawn이 그 자리에서 던진다. 그대로 두면
    // 화면에는 500만 뜨고 원인이 전달되지 않는다.
    session = {
      profile,
      child: null,
      output: "",
      verificationUrl: null,
      userCode: null,
      usingDeviceCode: useDeviceCode,
      state: "failed",
      message: error instanceof Error ? error.message : CLI_MISSING_MESSAGE,
    };
    return readLoginState();
  }
  const current: LoginSession = {
    profile,
    child,
    output: "",
    verificationUrl: null,
    userCode: null,
    usingDeviceCode: useDeviceCode,
    state: "pending",
    message: "",
  };
  session = current;

  const absorb = (chunk: Buffer) => {
    current.output += chunk.toString();
    // 출력이 길어져도 화면에는 마지막 부분만 필요하다. 무한히 쌓지 않는다.
    if (current.output.length > 8000) current.output = current.output.slice(-8000);
    const scraped = scrapeVerification(current.output);
    current.verificationUrl = scraped.url ?? current.verificationUrl;
    current.userCode = scraped.code ?? current.userCode;
  };
  child.stdout?.on("data", absorb);
  child.stderr?.on("data", absorb);
  child.on("error", (error: NodeJS.ErrnoException) => {
    // 취소로 이미 끝난 세션이 뒤늦은 오류로 실패가 되면 안 된다.
    if (current.state !== "pending") return;
    current.state = "failed";
    current.child = null;
    current.message = error.code === "ENOENT" ? CLI_MISSING_MESSAGE : error.message;
  });
  child.on("close", (code) => {
    current.child = null;
    if (current.state !== "pending") return;
    if (code === 0) {
      current.state = "succeeded";
      return;
    }
    current.state = "failed";
    const detail = stripAnsi(current.output).trim().split("\n").slice(-3).join(" ").trim();
    current.message = /could not be found|does not exist/i.test(current.output)
      ? `AWS 프로필 "${profile}"이 이 PC에 없습니다. 터미널에서 aws configure sso --profile ${profile} 을 먼저 실행하세요.`
      : detail || `로그인이 실패했습니다 (종료 코드 ${code}).`;
  });

  return readLoginState();
}

export function readLoginState(): AwsSsoLoginState {
  if (!session) return { state: "idle" };
  if (session.state === "pending") {
    return {
      state: "pending",
      profile: session.profile,
      verificationUrl: session.verificationUrl,
      userCode: session.userCode,
      usingDeviceCode: session.usingDeviceCode,
      output: session.output,
    };
  }
  if (session.state === "succeeded") {
    return { state: "succeeded", profile: session.profile, output: session.output };
  }
  if (session.state === "cancelled") {
    return { state: "cancelled", profile: session.profile };
  }
  return {
    state: "failed",
    profile: session.profile,
    output: session.output,
    message: session.message,
  };
}

/**
 * 진행 중인 로그인을 중단한다.
 *
 * 상태를 지우지 않고 `cancelled`로 남기는 이유는, 지워 버리면 화면이 "아무 일도
 * 없었음"으로 되돌아가 사용자가 취소가 먹혔는지 알 수 없기 때문이다.
 */
export function cancelAwsSsoLogin(): AwsSsoLoginState {
  if (!session) return { state: "idle" };
  if (session.state === "pending") {
    session.child?.kill("SIGKILL");
    session.child = null;
    session.state = "cancelled";
  }
  return readLoginState();
}

/**
 * 캐시된 토큰을 지운다. 계정을 바꿔 붙이거나, 어중간하게 남은 세션을 정리할 때 쓴다.
 * 로그인이 안 되어 있어도 CLI가 오류를 내지 않으므로 결과를 그대로 전달한다.
 */
export async function logoutAwsSso(profile: string): Promise<{ ok: boolean; message: string }> {
  assertValidProfileName(profile);
  const result = await runAws(["sso", "logout", "--profile", profile], 30_000);
  if (result.missing) return { ok: false, message: CLI_MISSING_MESSAGE };
  if (result.code === 0) {
    // 다음 상태 조회가 옛 로그인 진행 상황을 다시 보여 주지 않도록 정리한다.
    session = null;
    return { ok: true, message: "로그아웃했습니다." };
  }
  const detail = `${result.stderr}\n${result.stdout}`.trim().split("\n").slice(-3).join(" ").trim();
  return { ok: false, message: detail || `로그아웃이 실패했습니다 (종료 코드 ${result.code}).` };
}

/** 테스트에서 모듈 상태를 초기화한다. */
export function resetAwsSsoSessionForTests(): void {
  session = null;
}
