/**
 * AWS CLI의 SSO 토큰 캐시에서 만료 시각만 읽는다.
 *
 * 로그인이 살아 있는지는 `sts get-caller-identity`로 판정한다 — 캐시에 만료
 * 시각이 남아 있어도 토큰이 철회되었을 수 있으니 실제로 자격증명을 써 보는
 * 쪽이 정확하다. 다만 그 호출은 "언제까지 유효한가"는 알려 주지 않는다.
 *
 * 세션이 몇 시간마다 끊기는 배포이므로 "언제 다시 로그인해야 하나"가 실제로
 * 필요한 정보다. 그 값은 캐시 파일에만 있으므로, 판정은 CLI에 맡기고 남은
 * 시간만 여기서 읽어 화면에 덧붙인다.
 *
 * 토큰 값 자체는 읽지 않는다. 필요한 것은 `startUrl`과 `expiresAt`뿐이다.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface AwsSsoCachedToken {
  startUrl: string;
  expiresAt: string;
}

/** `aws sso login`이 토큰을 넣어 두는 곳. */
export function awsSsoCacheDirectoryPath(): string {
  return path.join(homedir(), ".aws", "sso", "cache");
}

/**
 * CLI가 적는 만료 시각을 `Date`가 읽을 수 있는 모양으로 바꾼다.
 * 옛 CLI는 `2026-07-27T04:05:45UTC`처럼 ISO 8601이 아닌 값을 적었고,
 * 그대로 파싱하면 Invalid Date가 된다.
 */
export function normalizeAwsSsoExpiry(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = trimmed.endsWith("UTC") ? `${trimmed.slice(0, -3)}Z` : trimmed;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * 캐시 항목 하나. 같은 폴더에 있는 다른 파일에는 null을 준다 — 클라이언트 등록
 * 파일(`botocore-client-id-*.json`)에도 만료 시각이 있지만 포털 주소가 없고,
 * 그것을 세션으로 세면 있지도 않은 로그인 상태를 보고하게 된다.
 */
export function parseAwsSsoCacheEntry(document: unknown): AwsSsoCachedToken | null {
  if (typeof document !== "object" || document === null) return null;
  const record = document as Record<string, unknown>;
  const startUrl = typeof record.startUrl === "string" ? record.startUrl.trim() : "";
  const accessToken = typeof record.accessToken === "string" ? record.accessToken : "";
  const rawExpiry = typeof record.expiresAt === "string" ? record.expiresAt : "";
  if (!startUrl || !accessToken || !rawExpiry) return null;
  const expiresAt = normalizeAwsSsoExpiry(rawExpiry);
  return expiresAt ? { startUrl, expiresAt } : null;
}

/**
 * 포털 주소별 가장 늦은 만료 시각. 캐시 폴더가 없으면 빈 Map.
 *
 * 파일 이름이 아니라 파일 안의 `startUrl`로 맞추는 이유는, CLI가 파일 이름을
 * 만드는 규칙이 옛 형식과 sso-session 형식에서 서로 다르기 때문이다.
 */
export function readAwsSsoTokenExpiries(directory = awsSsoCacheDirectoryPath()): Map<string, string> {
  let fileNames: string[];
  try {
    fileNames = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return new Map();
  }

  const expiries = new Map<string, string>();
  for (const fileName of fileNames) {
    let entry: AwsSsoCachedToken | null = null;
    try {
      entry = parseAwsSsoCacheEntry(JSON.parse(readFileSync(path.join(directory, fileName), "utf8")));
    } catch {
      // 캐시 폴더에 반쯤 쓰이다 만 파일이 있는 것은 오류가 아니다.
      continue;
    }
    if (!entry) continue;
    // 한 포털에 대한 파일이 여럿일 수 있다(등록마다 하나). 가장 늦은 것이 이긴다.
    const known = expiries.get(entry.startUrl);
    if (!known || Date.parse(entry.expiresAt) > Date.parse(known)) {
      expiries.set(entry.startUrl, entry.expiresAt);
    }
  }
  return expiries;
}
