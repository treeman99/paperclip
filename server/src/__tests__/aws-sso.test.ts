/**
 * AWS CLI 출력에서 인증 주소와 코드를 뽑아내는 부분의 검증.
 *
 * 이 문구는 AWS CLI 버전마다 조금씩 다르고 우리가 통제할 수 없다. 그래서 정확한
 * 문장을 찾지 않고 주소 모양과 코드 모양으로 찾는데, 그 판단이 실제 출력에서
 * 동작하는지는 이렇게밖에 확인할 방법이 없다.
 */

import { describe, expect, it } from "vitest";
import { assertValidProfileName, scrapeVerification } from "../adapters/aws-sso.js";

describe("인증 주소와 코드 추출", () => {
  it("AWS CLI v2의 기본 출력에서 둘 다 찾는다", () => {
    const output = [
      "Attempting to automatically open the SSO authorization page in your default browser.",
      "If the browser does not open or you wish to use a different device to authorize this request, open the following URL:",
      "",
      "https://device.sso.us-west-2.amazonaws.com/",
      "",
      "Then enter the code:",
      "",
      "MFTG-QDTX",
    ].join("\n");
    expect(scrapeVerification(output)).toEqual({
      url: "https://device.sso.us-west-2.amazonaws.com/",
      code: "MFTG-QDTX",
    });
  });

  it("주소 뒤에 붙은 문장 부호는 떼어 낸다", () => {
    const { url } = scrapeVerification("open https://device.sso.eu-west-1.amazonaws.com/,");
    expect(url).toBe("https://device.sso.eu-west-1.amazonaws.com/");
  });

  it("코드가 붙은 verify 주소 형태도 인식한다", () => {
    const output = "https://d-1234.awsapps.com/start/#/device?user_code=ABCD-EFGH";
    // 이 형태에는 amazonaws.com/device 가 없으므로 /verify 규칙이 받는다.
    expect(scrapeVerification(`https://example.com/verify?code=1 ${output}`).url).toBe(
      "https://example.com/verify?code=1",
    );
  });

  it("아직 아무것도 안 나왔으면 둘 다 null이다", () => {
    expect(scrapeVerification("Attempting to open the browser...")).toEqual({
      url: null,
      code: null,
    });
  });
});

describe("프로필 이름 검사", () => {
  it("평범한 이름은 통과한다", () => {
    expect(() => assertValidProfileName("corp-sso")).not.toThrow();
    expect(() => assertValidProfileName("corp.sso_1")).not.toThrow();
  });

  it("명령 인자로 위험한 문자는 막는다", () => {
    // 이 값은 그대로 `aws sso login --profile <값>` 의 인자가 된다.
    for (const bad of ["corp sso", "corp;rm -rf /", "--profile", "corp\nsso", ""]) {
      expect(() => assertValidProfileName(bad)).toThrow(/쓸 수 없습니다/);
    }
  });
});
