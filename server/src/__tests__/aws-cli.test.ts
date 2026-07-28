/**
 * Windows에서 AWS CLI를 찾는 부분의 검증.
 *
 * 사내 설치본은 네이티브 Windows 개인 PC에서 돌지만 개발과 CI는 macOS/리눅스다.
 * 그래서 platform과 파일 존재 확인을 인자로 받게 만들어 두었고, 여기서 그 분기를
 * 시험한다. 이 부분이 틀리면 멀쩡히 설치된 PC에 "AWS CLI 없음"이 뜬다.
 */

import { describe, expect, it } from "vitest";
import { awsSpawnTarget, buildAwsEnv, resolveAwsCommand } from "../adapters/aws-cli.js";

const win = { platform: "win32" as const };

describe("AWS CLI 경로 해석", () => {
  it("Windows가 아니면 그냥 aws다", () => {
    expect(resolveAwsCommand({ PATH: "/usr/bin" }, { platform: "darwin" })).toBe("aws");
  });

  it("PATH에서 PATHEXT 확장자를 붙여 찾는다", () => {
    const found = "C:\\tools\\aws.exe";
    expect(
      resolveAwsCommand(
        { PATH: "C:\\tools", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        { ...win, fileExists: (candidate) => candidate === found },
      ),
    ).toBe(found);
  });

  it("확장자 없는 이름만으로는 못 찾던 .cmd 형태도 찾는다", () => {
    // Node의 spawn은 PATHEXT를 보지 않는다. 이 검사가 없으면 `aws.cmd`만 있는
    // 설치본이 통째로 "없음"이 된다.
    const found = "C:\\tools\\aws.cmd";
    expect(
      resolveAwsCommand(
        { PATH: "C:\\tools", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
        { ...win, fileExists: (candidate) => candidate === found },
      ),
    ).toBe(found);
  });

  it("PATH가 여러 개면 앞의 것이 이긴다", () => {
    expect(
      resolveAwsCommand(
        { PATH: "C:\\first;C:\\second", PATHEXT: ".EXE" },
        { ...win, fileExists: () => true },
      ),
    ).toBe("C:\\first\\aws.exe");
  });

  it("PATH에 없으면 MSI 설치 경로를 확인한다", () => {
    // 서버를 띄운 뒤에 설치하면 PATH에는 없고 설치 경로에는 있다.
    const installed = "C:\\Program Files\\Amazon\\AWS CLI\\aws.exe";
    expect(
      resolveAwsCommand(
        { PATH: "C:\\nothing", PATHEXT: ".EXE", ProgramFiles: "C:\\Program Files" },
        { ...win, fileExists: (candidate) => candidate === installed },
      ),
    ).toBe(installed);
  });

  it("사용자 단위 설치 경로도 확인한다", () => {
    // 관리자 권한이 없는 계정은 이쪽으로 설치하게 된다.
    const installed = "C:\\Users\\me\\AppData\\Local\\Amazon\\AWSCLIV2\\aws.exe";
    expect(
      resolveAwsCommand(
        { PATH: "", PATHEXT: ".EXE", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
        { ...win, fileExists: (candidate) => candidate === installed },
      ),
    ).toBe(installed);
  });

  it("아무 데도 없으면 aws를 그대로 돌려준다", () => {
    // "설치 안 됨"으로 단정하지 않는다. 실행을 시도해 보고 CLI가 내는 오류를
    // 사용자에게 전달하는 편이 낫다.
    expect(
      resolveAwsCommand({ PATH: "C:\\nothing", PATHEXT: ".EXE" }, { ...win, fileExists: () => false }),
    ).toBe("aws");
  });

  it("환경 변수 이름의 대소문자를 가리지 않는다", () => {
    // Windows의 process.env는 대소문자를 구분하지 않는다.
    expect(
      resolveAwsCommand({ Path: "C:\\tools", PathExt: ".EXE" }, { ...win, fileExists: () => true }),
    ).toBe("C:\\tools\\aws.exe");
  });
});

describe("AWS CLI 실행 환경", () => {
  it("페이저를 끈다", () => {
    // 켜져 있으면 sso login이 찍는 인증 주소가 페이저 안에 갇힌다.
    expect(buildAwsEnv({ AWS_PAGER: "less" }).AWS_PAGER).toBe("");
  });

  it("나머지 환경 변수는 그대로 둔다", () => {
    expect(buildAwsEnv({ AWS_PROFILE: "corp" }).AWS_PROFILE).toBe("corp");
  });
});

describe("실행 대상 결정", () => {
  it("exe는 그대로 실행한다", () => {
    expect(awsSpawnTarget("C:\\tools\\aws.exe", ["sso", "login"], win)).toEqual({
      command: "C:\\tools\\aws.exe",
      args: ["sso", "login"],
    });
  });

  it(".cmd는 cmd.exe를 거친다", () => {
    // Node의 spawn은 shell 없이 배치 파일을 직접 실행하지 못한다.
    const target = awsSpawnTarget("C:\\tools\\aws.cmd", ["sso", "login"], win);
    expect(target.command.toLowerCase()).toContain("cmd.exe");
    expect(target.args).toEqual(["/d", "/c", "C:\\tools\\aws.cmd", "sso", "login"]);
  });

  it("Windows가 아니면 아무것도 감싸지 않는다", () => {
    expect(awsSpawnTarget("aws", ["--version"], { platform: "linux" })).toEqual({
      command: "aws",
      args: ["--version"],
    });
  });
});
