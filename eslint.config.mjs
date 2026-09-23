import html from "eslint-plugin-html";
import globals from "globals";

// 이음 index.html 안의 <script>를 검사한다.
// 핵심은 no-undef: 정의 안 된 변수(예: 예전의 `n is not defined` 버그)를 올리기 전에 잡는다.
export default [
  {
    files: ["**/*.html"],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-redeclare": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
    },
  },
];
