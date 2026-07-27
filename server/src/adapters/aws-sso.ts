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
 */

import { spawn } from "node:child_process";

/**
 * 프로필 이름은 그대로 명령 인자로 들어가므로 모양을 좁게 제한한다.
 *
 * 첫 글자에 `-`를 막는 것이 핵심이다. `--profile` 같은 이름을 허용하면 AWS CLI가
 * 그것을 값이 아니라 또 하나의 플래그로 읽는다.
 */
const PROFILE_NAME_RE = /^[A-Za-z0-9._][A-Za-z0-9._-]{0,127}$/;

/** Windows에서 shell 없이 실행하려면 확장자가 필요하다. */
function awsCommand(): string {
  return process.platform === "win32" ? "aws.exe" : "aws";
}

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
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(awsCommand(), args, { windowsHide: true });
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

export type AwsSsoStatus =
  | { state: "cli_missing"; message: string }
  | { state: "profile_missing"; message: string; remediation: string }
  | { state: "logged_out"; message: string }
  | { state: "logged_in"; accountId: string | null; arn: string | null };

/**
 * 현재 세션이 살아 있는지 확인한다.
 *
 * `sts get-caller-identity`를 쓰는 이유는 SSO 캐시 파일을 직접 읽는 것보다 정확해서다.
 * 캐시에 만료 시각이 남아 있어도 토큰이 철회되었을 수 있고, 캐시 파일 형식은
 * AWS CLI 버전에 따라 달라진다. 실제로 자격증명을 써 보는 것이 유일하게 믿을 만하다.
 */
export async function getAwsSsoStatus(profile: string): Promise<AwsSsoStatus> {
  assertValidProfileName(profile);
  const result = await runAws(
    ["sts", "get-caller-identity", "--profile", profile, "--output", "json"],
    20_000,
  );
  if (result.missing) {
    return {
      state: "cli_missing",
      message:
        "AWS CLI를 찾지 못했습니다. AWS CLI v2를 설치한 뒤 서버를 다시 시작하세요.",
    };
  }
  if (result.code === 0) {
    try {
      const parsed = JSON.parse(result.stdout) as { Account?: string; Arn?: string };
      return { state: "logged_in", accountId: parsed.Account ?? null, arn: parsed.Arn ?? null };
    } catch {
      return { state: "logged_in", accountId: null, arn: null };
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
      output: string;
    }
  | { state: "succeeded"; profile: string; output: string }
  | { state: "failed"; profile: string; output: string; message: string };

interface LoginSession {
  profile: string;
  child: ReturnType<typeof spawn> | null;
  output: string;
  verificationUrl: string | null;
  userCode: string | null;
  state: "pending" | "succeeded" | "failed";
  message: string;
}

let session: LoginSession | null = null;

/**
 * CLI 출력에서 인증 URL과 코드를 뽑는다.
 *
 * AWS CLI는 브라우저를 자동으로 열지만 사내 PC에서는 실패하는 경우가 있어,
 * 같은 출력에 담긴 URL과 코드를 화면에도 띄운다. 형식이 버전마다 조금씩 달라
 * 정확한 문장 대신 URL 모양과 코드 모양으로 찾는다.
 */
export function scrapeVerification(output: string): { url: string | null; code: string | null } {
  const url = output.match(/https:\/\/\S*device\S*\.amazonaws\.com\S*/i)?.[0]
    ?? output.match(/https:\/\/\S+\/verify\S*/i)?.[0]
    ?? null;
  const code = output.match(/\b[A-Z]{4}-[A-Z]{4}\b/)?.[0] ?? null;
  return { url: url?.replace(/[.,)]+$/, "") ?? null, code };
}

/**
 * 로그인을 시작한다. 이미 진행 중이면 그 세션을 그대로 돌려준다 — 버튼을 두 번
 * 눌렀다고 CLI 프로세스가 둘이 되면 둘 다 같은 SSO 캐시를 쓰다 서로를 방해한다.
 */
export function startAwsSsoLogin(profile: string): AwsSsoLoginState {
  assertValidProfileName(profile);
  if (session?.state === "pending") return readLoginState();

  const child = spawn(awsCommand(), ["sso", "login", "--profile", profile], {
    windowsHide: true,
  });
  const current: LoginSession = {
    profile,
    child,
    output: "",
    verificationUrl: null,
    userCode: null,
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
    current.state = "failed";
    current.child = null;
    current.message =
      error.code === "ENOENT"
        ? "AWS CLI를 찾지 못했습니다. AWS CLI v2를 설치한 뒤 서버를 다시 시작하세요."
        : error.message;
  });
  child.on("close", (code) => {
    current.child = null;
    if (code === 0) {
      current.state = "succeeded";
      return;
    }
    current.state = "failed";
    const detail = current.output.trim().split("\n").slice(-3).join(" ").trim();
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
      output: session.output,
    };
  }
  if (session.state === "succeeded") {
    return { state: "succeeded", profile: session.profile, output: session.output };
  }
  return {
    state: "failed",
    profile: session.profile,
    output: session.output,
    message: session.message,
  };
}

/** 진행 중인 로그인을 중단한다. */
export function cancelAwsSsoLogin(): void {
  if (session?.child) {
    session.child.kill("SIGKILL");
  }
  session = null;
}

/** 테스트에서 모듈 상태를 초기화한다. */
export function resetAwsSsoSessionForTests(): void {
  session = null;
}
