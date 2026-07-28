/**
 * `~/.aws/config`에서 SSO로 로그인할 수 있는 프로필 목록을 읽는다.
 *
 * 프로필 이름을 손으로 받아 적게 하면, 오타 하나가 "프로필 없음"으로 돌아오는데
 * 사용자는 이름이 틀린 건지 프로필을 안 만든 건지 알 수 없다. 이 PC에 실제로
 * 있는 이름을 목록으로 보여 주면 그 구분이 필요 없어진다.
 *
 * 파일은 읽기만 한다. 쓰지 않는 이유는 사내 SSO 설정이 조직마다 다르고, 이미
 * 있는 프로필을 덮어써 다른 작업을 망가뜨리는 쪽이 훨씬 나쁘기 때문이다.
 *
 * 형식이 두 가지이고 둘 다 현역이다.
 *
 *   [profile dev]                 옛 형식: 프로필이 포털 주소를 직접 들고 있다
 *   sso_start_url = https://…
 *   sso_region = ap-northeast-2
 *
 *   [sso-session corp]            sso-session 형식: 주소는 공용 블록에 두고
 *   sso_start_url = https://…     프로필은 이름으로 가리킨다.
 *   sso_region = ap-northeast-2   요즘 `aws configure sso`가 만드는 모양이다.
 *   [profile dev]
 *   sso_session = corp
 *
 * 포털 주소를 끝내 못 찾은 항목은 버린다. 이 목록이 답해야 하는 질문은 "무슨
 * 프로필이 있나"가 아니라 "무엇으로 로그인할 수 있나"다.
 *
 * 파싱을 순수 함수로 떼어 둔 것은 INI의 잔가지들(주석, 중첩 블록, 중복 이름)을
 * 파일 없이 시험하기 위해서다.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface AwsSsoProfile {
  /** `--profile`에 그대로 넘길 이름. `default`이거나 `profile ` 뒤의 이름. */
  name: string;
  /** 사내 IdP 포털 주소. 프로필 자신 또는 `sso-session` 블록에서 온다. */
  startUrl: string;
  /** SSO/OIDC 엔드포인트가 있는 리전. 설정에 없으면 null. */
  ssoRegion: string | null;
  /** `sso_account_id` — 어떤 계정으로 들어가는지 보여 주기 위한 값. */
  accountId: string | null;
  /** `sso_role_name` — 같은 목적. */
  roleName: string | null;
  /** 이 프로필이 물려받는 `sso-session` 블록 이름. 없으면 null. */
  sessionName: string | null;
}

interface Section {
  kind: "profile" | "sso-session";
  name: string;
  keys: Map<string, string>;
}

const SECTION_RE = /^\[([^\]]+)\]\s*(?:[#;].*)?$/;
const KEY_VALUE_RE = /^(\s*)([^=\s][^=]*?)\s*=\s*(.*?)\s*$/;

function classify(header: string): Section | null {
  const trimmed = header.trim();
  if (trimmed === "default") {
    return { kind: "profile", name: "default", keys: new Map() };
  }
  const profile = trimmed.match(/^profile\s+(.+)$/);
  if (profile) {
    return { kind: "profile", name: profile[1]!.trim(), keys: new Map() };
  }
  const session = trimmed.match(/^sso-session\s+(.+)$/);
  if (session) {
    return { kind: "sso-session", name: session[1]!.trim(), keys: new Map() };
  }
  // `[services …]`, `[plugins]` 등 이 기능이 읽지 않는 구역.
  return null;
}

/**
 * AWS는 앞에 공백이 있는 `#`/`;`만 줄 안쪽 주석으로 본다. 그래서 주소에 붙은
 * `#`은 값의 일부로 남는다.
 */
function stripInlineComment(value: string): string {
  return value.replace(/\s+[#;].*$/, "").trim();
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";");
}

function readSections(contents: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  // 값이 비어 있는 `key =`는 중첩 블록을 연다(예: `s3 =`). 그 아래 들여쓴 줄은
  // 프로필의 키가 아니므로 같은 이름의 프로필 키를 덮어쓰면 안 된다.
  let nestedIndent: number | null = null;

  for (const line of contents.split(/\r?\n/)) {
    if (isBlankOrComment(line)) continue;

    const header = line.match(SECTION_RE);
    if (header) {
      nestedIndent = null;
      current = classify(header[1]!);
      if (current) sections.push(current);
      continue;
    }

    const pair = line.match(KEY_VALUE_RE);
    if (!pair || !current) continue;

    const indent = pair[1]!.length;
    if (nestedIndent !== null && indent > nestedIndent) continue;
    nestedIndent = null;

    const key = pair[2]!.trim().toLowerCase();
    const value = stripInlineComment(pair[3]!);
    if (value.length === 0) {
      nestedIndent = indent;
      continue;
    }
    current.keys.set(key, value);
  }

  return sections;
}

/** 설정 파일 내용에서 SSO 로그인이 가능한 프로필들을 파일에 적힌 순서대로. */
export function parseAwsConfigSsoProfiles(contents: string): AwsSsoProfile[] {
  const sections = readSections(contents);
  const sessions = new Map(
    sections.filter((section) => section.kind === "sso-session").map((s) => [s.name, s.keys]),
  );

  const profiles: AwsSsoProfile[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (section.kind !== "profile" || seen.has(section.name)) continue;

    const sessionName = section.keys.get("sso_session") ?? null;
    const session = sessionName ? sessions.get(sessionName) : undefined;
    const startUrl = section.keys.get("sso_start_url") ?? session?.get("sso_start_url") ?? null;
    if (!startUrl) continue;

    seen.add(section.name);
    profiles.push({
      name: section.name,
      startUrl,
      ssoRegion: section.keys.get("sso_region") ?? session?.get("sso_region") ?? null,
      accountId: section.keys.get("sso_account_id") ?? null,
      roleName: section.keys.get("sso_role_name") ?? null,
      sessionName,
    });
  }
  return profiles;
}

/** AWS CLI가 읽는 설정 파일 경로. CLI와 마찬가지로 `AWS_CONFIG_FILE`을 존중한다. */
export function awsConfigFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AWS_CONFIG_FILE?.trim();
  return override ? override : path.join(homedir(), ".aws", "config");
}

export interface AwsSsoConfigRead {
  /** 실제로 읽은 파일. 파일이 아예 없으면 null. */
  configPath: string | null;
  profiles: AwsSsoProfile[];
}

export function readAwsSsoProfiles(env: NodeJS.ProcessEnv = process.env): AwsSsoConfigRead {
  const configPath = awsConfigFilePath(env);
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error) {
    // 파일이 없는 것은 "아직 aws configure sso를 한 적 없음"이라는 흔한 상태다.
    // 그 외(권한, 경로에 디렉터리)는 원인을 남겨 두어야 추적할 수 있다.
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(`[aws-sso] ${configPath} 를 읽지 못했습니다: ${String(error)}`);
    }
    return { configPath: null, profiles: [] };
  }
  return { configPath, profiles: parseAwsConfigSsoProfiles(contents) };
}
