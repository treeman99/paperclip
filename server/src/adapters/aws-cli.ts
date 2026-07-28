/**
 * AWS CLI를 어디서, 어떤 환경으로 실행할지.
 *
 * `spawn("aws")`로 끝내지 않는 이유는 Windows 때문이다. 사내 설치본은 개인 PC의
 * 네이티브 Windows에서 돌고, 거기서 다음 두 가지가 실제로 발목을 잡는다.
 *
 *   1. `aws`라는 이름만으로는 `.cmd`/`.bat` 형태의 실행 파일을 찾지 못한다.
 *      Node의 spawn은 PATHEXT를 보지 않으므로 PATH에 `aws.cmd`만 있는 설치본에서는
 *      "AWS CLI 없음"이 된다. 반대로 `aws.exe`로 못박으면 그 반대 경우를 놓친다.
 *   2. 서버 프로세스는 시작할 때의 PATH를 그대로 들고 산다. 서버를 띄운 다음
 *      AWS CLI를 설치하면, 새 터미널에서는 `aws --version`이 되는데 화면에서는
 *      계속 "없음"으로 보인다.
 *
 * 그래서 PATH를 PATHEXT까지 훑어보고, 못 찾으면 MSI가 설치하는 고정 경로를
 * 직접 확인한다. 2번은 대개 이 고정 경로 확인으로 해결된다 — 설치 위치는
 * 바뀌지 않고 바뀐 것은 PATH뿐이기 때문이다. 레지스트리에서 PATH를 다시
 * 읽어들이는 방법도 있지만(Orca가 그렇게 한다), 여기서는 얻는 것에 비해
 * `reg.exe` 호출과 파싱이 붙는 비용이 커서 넣지 않았다. 정말 특이한 경로에
 * 설치한 뒤 PATH만 갱신한 경우에는 서버를 다시 시작하면 된다.
 *
 * `platform`과 `fileExists`를 인자로 받는 것은 win32 분기를 macOS/리눅스에서
 * 시험하기 위해서다.
 */

import { existsSync } from "node:fs";
import path from "node:path";

/** PATHEXT가 없을 때 Windows가 쓰는 기본값. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface AwsCommandOptions {
  platform?: NodeJS.Platform;
  fileExists?: (candidate: string) => boolean;
}

/** Windows의 `process.env`는 대소문자를 가리지 않지만, 테스트의 평범한 객체는 가린다. */
function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name];
  if (direct !== undefined) return direct;
  const lowered = name.toLowerCase();
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lowered);
  return key ? env[key] : undefined;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * AWS CLI v2 MSI가 설치하는 고정 경로들. PATH를 먼저 보고 못 찾았을 때만 쓰므로,
 * PATH에 다른 버전이 잡혀 있으면 그쪽이 이긴다.
 */
function installerCandidates(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    readEnv(env, "ProgramW6432"),
    readEnv(env, "ProgramFiles"),
    readEnv(env, "ProgramFiles(x86)"),
    "C:\\Program Files",
  ];
  const candidates = roots
    .filter((root): root is string => !!root)
    .map((root) => path.win32.join(root, "Amazon", "AWS CLI", "aws.exe"));

  // 관리자 권한이 없는 계정이 쓰게 되는 사용자 단위 설치.
  const localAppData = readEnv(env, "LOCALAPPDATA");
  if (localAppData) {
    candidates.push(path.win32.join(localAppData, "Amazon", "AWSCLIV2", "aws.exe"));
  }
  return candidates;
}

/**
 * 실행할 AWS CLI의 절대 경로. 아무것도 못 찾으면 `aws`를 그대로 돌려준다 —
 * 그래야 특이한 설치 형태에서도 일단 실행을 시도해 보고, 실패하면 CLI가 내는
 * 오류가 사용자에게 전달된다. "설치 안 됨"으로 단정하지 않는다.
 */
export function resolveAwsCommand(
  env: NodeJS.ProcessEnv = process.env,
  options: AwsCommandOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return "aws";

  const exists = options.fileExists ?? existsSync;
  const extensions = splitList(readEnv(env, "PATHEXT") ?? DEFAULT_PATHEXT);

  for (const directory of splitList(readEnv(env, "PATH"))) {
    for (const extension of extensions) {
      // 소문자로 만드는 것은 로그 가독성 때문이다. NTFS는 대소문자를 가리지 않는다.
      const candidate = path.win32.join(directory, `aws${extension.toLowerCase()}`);
      if (exists(candidate)) return candidate;
    }
  }

  for (const candidate of installerCandidates(env)) {
    if (exists(candidate)) return candidate;
  }
  return "aws";
}

/**
 * AWS CLI를 실행할 환경.
 *
 * `AWS_PAGER`를 비우는 것이 핵심이다. AWS CLI v2는 출력이 길면 페이저에 넘기는데,
 * 그러면 `sso login`이 찍는 인증 주소와 코드가 페이저 안에 갇혀 우리 쪽으로
 * 흘러나오지 않는다. 화면에 주소가 끝내 안 뜨는 형태로 조용히 실패한다.
 */
export function buildAwsEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, AWS_PAGER: "" };
}

/**
 * Windows에서 `.cmd`/`.bat` 실행 파일은 cmd.exe를 거쳐야 한다. Node의 spawn은
 * shell 없이 배치 파일을 직접 실행하지 못한다.
 *
 * cmd.exe에 넘기는 인자에 메타문자가 섞이면 위험하지만, 이 경로로 오는 인자는
 * 고정 문자열과 `assertValidProfileName`을 통과한 프로필 이름뿐이다.
 */
export function awsSpawnTarget(
  command: string,
  args: string[],
  options: AwsCommandOptions = {},
): { command: string; args: string[] } {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }
  const comspec = readEnv(process.env, "COMSPEC") ?? "C:\\Windows\\System32\\cmd.exe";
  return { command: comspec, args: ["/d", "/c", command, ...args] };
}
