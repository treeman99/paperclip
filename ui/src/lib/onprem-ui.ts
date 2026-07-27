/**
 * 사내 배포본에서 화면을 좁히는 스위치.
 *
 * 이 배포본의 에이전트는 LLM에 대해 "레인 이름 하나"만 고른다. 실행 명령, 환경
 * 변수, 시크릿 접근, 타임아웃, 실행 정책 같은 upstream의 설정 항목은 서버가
 * 어차피 정책으로 거부하거나 설치본 전체에 고정된 값이라, 화면에 남겨 두면
 * 사용자가 고칠 수 있을 것처럼 보이는 함정이 된다.
 *
 * 코드를 지우는 대신 여기서 가리는 이유는 upstream 동기화 때문이다. 원본 저장소의
 * 큰 파일들(AgentConfigForm 등)을 잘라내면 싱크마다 충돌이 나고 되돌리기 어렵다.
 * 이 파일 하나를 바꾸면 화면 전체가 원래대로 돌아온다.
 *
 * 빌드 시점에 되돌리려면:
 *   VITE_PAPERCLIP_AGENT_UI_MODE=full
 */

/**
 * 값을 미리 읽어 두지 않고 호출할 때마다 읽는다.
 *
 * 모듈을 불러오는 시점에 고정하면 테스트가 환경 변수를 바꿔도 반영되지 않는다.
 * 한 번의 문자열 비교라 비용은 무시할 만하다.
 */
function resolveMode(): "full" | "onprem" {
  const raw = import.meta.env?.VITE_PAPERCLIP_AGENT_UI_MODE;
  return typeof raw === "string" && raw.trim() === "full" ? "full" : "onprem";
}

/** 좁힌 화면을 쓰는 배포본인지. */
export function isOnPremAgentUi(): boolean {
  return resolveMode() === "onprem";
}

/**
 * 에이전트 설정에서 LLM 접속과 무관한 실행 세부 항목을 감춘다.
 * (실행 명령, 작업 디렉터리, 추가 인자, 환경 변수, 시크릿 접근, 타임아웃)
 */
export function isAgentExecutionDetailHidden(): boolean {
  return resolveMode() === "onprem";
}

/**
 * 하트비트·동시 실행 수·쿨다운 같은 운영 파라미터를 감춘다.
 * 설치본 전체가 같은 값을 쓰므로 에이전트마다 다르게 둘 이유가 없다.
 */
export function isAgentRunPolicyHidden(): boolean {
  return resolveMode() === "onprem";
}

/**
 * 어댑터 종류 드롭다운과 모델 입력칸을 감춘다.
 * 둘 다 레인에서 파생되므로 직접 고르면 레인과 어긋난 조합이 만들어진다.
 */
export function isAgentAdapterPickerHidden(): boolean {
  return resolveMode() === "onprem";
}

/** 어댑터 설치·관리 화면을 감춘다. 두 레인 밖의 어댑터는 서버가 거부한다. */
export function isAdapterManagerHidden(): boolean {
  return resolveMode() === "onprem";
}
