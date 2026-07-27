import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    env: {
      // upstream 테스트는 원래의 전체 에이전트 설정 화면을 검증한다. 사내 배포본이
      // 화면을 좁힌 것은 별도 파일(onprem-ui.test.tsx)에서 확인하므로, 기본값은
      // 전체 화면으로 두어 원본 테스트를 고치지 않는다.
      VITE_PAPERCLIP_AGENT_UI_MODE: "full",
    },
  },
});
