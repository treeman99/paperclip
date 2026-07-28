/**
 * `~/.aws/config` 파서 검증.
 *
 * 이 파일은 우리가 만들지 않고 사용자의 PC에 이미 있는 것이므로, 우리가 예상한
 * 모양만 들어온다고 가정할 수 없다. 특히 sso-session 형식과 옛 형식이 한 파일에
 * 섞여 있는 경우가 흔하다.
 */

import { describe, expect, it } from "vitest";
import { parseAwsConfigSsoProfiles } from "../adapters/aws-config-profiles.js";

describe("AWS 설정 파일에서 SSO 프로필 읽기", () => {
  it("sso-session 형식에서 포털 주소를 물려받는다", () => {
    const contents = [
      "[sso-session corp]",
      "sso_start_url = https://corp.awsapps.com/start",
      "sso_region = ap-northeast-2",
      "",
      "[profile dev]",
      "sso_session = corp",
      "sso_account_id = 123456789012",
      "sso_role_name = Developer",
      "region = ap-northeast-2",
    ].join("\n");

    expect(parseAwsConfigSsoProfiles(contents)).toEqual([
      {
        name: "dev",
        startUrl: "https://corp.awsapps.com/start",
        ssoRegion: "ap-northeast-2",
        accountId: "123456789012",
        roleName: "Developer",
        sessionName: "corp",
      },
    ]);
  });

  it("옛 형식(프로필이 주소를 직접 가진 경우)도 읽는다", () => {
    const contents = [
      "[profile legacy]",
      "sso_start_url = https://old.awsapps.com/start",
      "sso_region = us-west-2",
    ].join("\n");

    const [profile] = parseAwsConfigSsoProfiles(contents);
    expect(profile?.name).toBe("legacy");
    expect(profile?.startUrl).toBe("https://old.awsapps.com/start");
    expect(profile?.sessionName).toBeNull();
  });

  it("[default] 구역도 프로필로 센다", () => {
    const contents = ["[default]", "sso_start_url = https://corp.awsapps.com/start"].join("\n");
    expect(parseAwsConfigSsoProfiles(contents).map((p) => p.name)).toEqual(["default"]);
  });

  it("SSO가 아닌 프로필은 버린다", () => {
    // 이 목록이 답해야 하는 것은 "무엇으로 로그인할 수 있나"이다.
    const contents = [
      "[profile static]",
      "region = us-east-1",
      "",
      "[profile sso]",
      "sso_start_url = https://corp.awsapps.com/start",
    ].join("\n");
    expect(parseAwsConfigSsoProfiles(contents).map((p) => p.name)).toEqual(["sso"]);
  });

  it("중첩 블록의 키가 프로필 키를 덮어쓰지 않는다", () => {
    // `s3 =` 아래 들여쓴 줄들은 프로필의 설정이 아니다.
    const contents = [
      "[profile dev]",
      "sso_start_url = https://corp.awsapps.com/start",
      "s3 =",
      "  sso_region = wrong-region",
      "sso_region = ap-northeast-2",
    ].join("\n");
    expect(parseAwsConfigSsoProfiles(contents)[0]?.ssoRegion).toBe("ap-northeast-2");
  });

  it("주석과 빈 줄을 무시한다", () => {
    const contents = [
      "; 사내 SSO",
      "[profile dev]  # 개발용",
      "# 주석",
      "sso_start_url = https://corp.awsapps.com/start  ; 포털",
      "",
    ].join("\n");
    expect(parseAwsConfigSsoProfiles(contents)[0]?.startUrl).toBe(
      "https://corp.awsapps.com/start",
    );
  });

  it("주소에 붙은 #은 주석이 아니다", () => {
    // AWS는 앞에 공백이 있는 #만 줄 안쪽 주석으로 본다.
    const contents = [
      "[profile dev]",
      "sso_start_url = https://corp.awsapps.com/start#/",
    ].join("\n");
    expect(parseAwsConfigSsoProfiles(contents)[0]?.startUrl).toBe(
      "https://corp.awsapps.com/start#/",
    );
  });

  it("[services] 같은 다른 구역은 프로필로 세지 않는다", () => {
    const contents = [
      "[services local]",
      "sso_start_url = https://not-a-profile.example.com",
      "",
      "[profile dev]",
      "sso_start_url = https://corp.awsapps.com/start",
    ].join("\n");
    expect(parseAwsConfigSsoProfiles(contents).map((p) => p.name)).toEqual(["dev"]);
  });

  it("이름이 중복되면 먼저 나온 것이 이긴다", () => {
    // 목록에 같은 이름이 두 번 뜨는 것만은 막아야 한다. 어느 쪽을 남길지는
    // 사실상 임의이므로, 파일 순서대로 처음 것을 쓴다.
    const contents = [
      "[profile dev]",
      "sso_start_url = https://first.awsapps.com/start",
      "",
      "[profile dev]",
      "sso_start_url = https://second.awsapps.com/start",
    ].join("\n");
    const profiles = parseAwsConfigSsoProfiles(contents);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.startUrl).toBe("https://first.awsapps.com/start");
  });

  it("CRLF 줄바꿈도 읽는다", () => {
    // Windows에서 메모장으로 고친 파일이 이렇게 된다.
    const contents = "[profile dev]\r\nsso_start_url = https://corp.awsapps.com/start\r\n";
    expect(parseAwsConfigSsoProfiles(contents)[0]?.name).toBe("dev");
  });
});
