/**
 * SSO 토큰 캐시에서 만료 시각을 읽는 부분의 검증.
 *
 * 이 폴더에는 우리가 만들지 않은 파일들이 섞여 있다. 그중 세션이 아닌 것을
 * 세션으로 세면, 로그인한 적 없는 사용자에게 "언제까지 유효" 같은 값이 붙는다.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeAwsSsoExpiry,
  parseAwsSsoCacheEntry,
  readAwsSsoTokenExpiries,
} from "../adapters/aws-sso-cache.js";

function cacheDirWith(files: Record<string, string>): string {
  const directory = mkdtempSync(path.join(tmpdir(), "aws-sso-cache-"));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), contents, "utf8");
  }
  return directory;
}

describe("만료 시각 정규화", () => {
  it("ISO 8601은 그대로 둔다", () => {
    expect(normalizeAwsSsoExpiry("2026-07-27T04:05:45Z")).toBe("2026-07-27T04:05:45Z");
  });

  it("옛 CLI가 쓰던 UTC 접미사를 Z로 바꾼다", () => {
    // `...45UTC`는 ISO가 아니라서 그대로 파싱하면 Invalid Date가 된다.
    expect(normalizeAwsSsoExpiry("2026-07-27T04:05:45UTC")).toBe("2026-07-27T04:05:45Z");
  });

  it("읽을 수 없는 값은 null이다", () => {
    expect(normalizeAwsSsoExpiry("나중에")).toBeNull();
    expect(normalizeAwsSsoExpiry("  ")).toBeNull();
  });
});

describe("캐시 항목 판별", () => {
  it("토큰과 포털 주소가 모두 있어야 세션이다", () => {
    expect(
      parseAwsSsoCacheEntry({
        startUrl: "https://corp.awsapps.com/start",
        accessToken: "token",
        expiresAt: "2026-07-27T04:05:45Z",
      }),
    ).toEqual({ startUrl: "https://corp.awsapps.com/start", expiresAt: "2026-07-27T04:05:45Z" });
  });

  it("클라이언트 등록 파일은 세션이 아니다", () => {
    // botocore-client-id-*.json 에도 만료 시각은 있지만 포털 주소가 없다.
    expect(
      parseAwsSsoCacheEntry({ clientId: "abc", clientSecret: "x", expiresAt: "2026-07-27T04:05:45Z" }),
    ).toBeNull();
  });

  it("JSON이 아닌 값은 세션이 아니다", () => {
    expect(parseAwsSsoCacheEntry("문자열")).toBeNull();
    expect(parseAwsSsoCacheEntry(null)).toBeNull();
  });
});

describe("캐시 폴더 읽기", () => {
  it("포털 주소별로 가장 늦은 만료 시각을 남긴다", () => {
    // 등록마다 파일이 하나씩 생겨 같은 포털이 여러 번 나온다.
    const directory = cacheDirWith({
      "old.json": JSON.stringify({
        startUrl: "https://corp.awsapps.com/start",
        accessToken: "t1",
        expiresAt: "2026-07-27T01:00:00Z",
      }),
      "new.json": JSON.stringify({
        startUrl: "https://corp.awsapps.com/start",
        accessToken: "t2",
        expiresAt: "2026-07-27T09:00:00Z",
      }),
    });
    expect(readAwsSsoTokenExpiries(directory).get("https://corp.awsapps.com/start")).toBe(
      "2026-07-27T09:00:00Z",
    );
  });

  it("깨진 파일이 있어도 나머지를 읽는다", () => {
    // 반쯤 쓰이다 만 파일이 폴더에 있는 것은 오류가 아니다.
    const directory = cacheDirWith({
      "broken.json": "{ 이건 JSON이 아니다",
      "good.json": JSON.stringify({
        startUrl: "https://corp.awsapps.com/start",
        accessToken: "t",
        expiresAt: "2026-07-27T09:00:00Z",
      }),
    });
    expect(readAwsSsoTokenExpiries(directory).size).toBe(1);
  });

  it("폴더가 없으면 빈 값이다", () => {
    expect(readAwsSsoTokenExpiries(path.join(tmpdir(), "없는-폴더-aws-sso")).size).toBe(0);
  });
});
