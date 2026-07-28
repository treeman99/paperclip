/**
 * AWS CLI 출력에서 인증 주소와 코드를 뽑아내는 부분의 검증.
 *
 * 이 문구는 AWS CLI 버전마다 조금씩 다르고 우리가 통제할 수 없다. 그래서 정확한
 * 문장을 찾지 않고 주소 모양과 코드 모양으로 찾는데, 그 판단이 실제 출력에서
 * 동작하는지는 이렇게밖에 확인할 방법이 없다.
 *
 * 특히 흐름이 두 가지라는 점이 중요하다. v2.22부터 기본값이 바뀌면서 주소가
 * `device.sso...`가 아니라 `oidc...`로 나오는데, 그 형태를 놓치면 화면에 주소가
 * 끝내 뜨지 않는 방식으로 조용히 실패한다.
 */

import { describe, expect, it } from "vitest";
import { assertValidProfileName, scrapeVerification } from "../adapters/aws-sso.js";

describe("인증 주소와 코드 추출", () => {
  it("장치 코드 흐름의 출력에서 둘 다 찾는다", () => {
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

  it("v2.22 이후 기본 흐름의 authorize 주소를 찾는다", () => {
    // 이 주소에는 device 도 verify 도 없다. 문구를 보고 찾지 않으면 놓친다.
    const output = [
      "Attempting to automatically open the SSO authorization page in your default browser.",
      "If the browser does not open or you wish to use a different device to authorize this request, open the following URL:",
      "",
      "https://oidc.ap-northeast-2.amazonaws.com/authorize?response_type=code&client_id=abc&code_challenge=xyz",
    ].join("\n");
    expect(scrapeVerification(output)).toEqual({
      url: "https://oidc.ap-northeast-2.amazonaws.com/authorize?response_type=code&client_id=abc&code_challenge=xyz",
      code: null,
    });
  });

  it("코드에 숫자가 섞여 있어도 찾는다", () => {
    // AWS가 주는 코드는 영문 전용이 아니다.
    const { code } = scrapeVerification("Then enter the code:\n\nWXYZ-1234");
    expect(code).toBe("WXYZ-1234");
  });

  it("주소 뒤에 붙은 문장 부호는 떼어 낸다", () => {
    const { url } = scrapeVerification(
      "open the following URL: https://device.sso.eu-west-1.amazonaws.com/,",
    );
    expect(url).toBe("https://device.sso.eu-west-1.amazonaws.com/");
  });

  it("안내 문구가 없어도 AWS 로그인 주소 모양이면 받는다", () => {
    const output = "https://d-1234.awsapps.com/start/#/device?user_code=ABCD-EFGH";
    expect(scrapeVerification(output)).toEqual({
      url: output,
      // 안내 문구는 없지만 주소 안에 코드가 실려 있다.
      code: "ABCD-EFGH",
    });
  });

  it("색이 입혀진 출력에서도 주소가 깨지지 않는다", () => {
    const output =
      "open the following URL: \u001b[4mhttps://device.sso.us-west-2.amazonaws.com/\u001b[0m";
    expect(scrapeVerification(output).url).toBe("https://device.sso.us-west-2.amazonaws.com/");
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
