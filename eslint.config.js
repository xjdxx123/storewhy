import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  { ignores: ["packages/hmem/**", "**/dist/**", "apps/web/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["apps/fallback-web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        location: "readonly",
        localStorage: "readonly",
        document: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        HTMLDialogElement: "readonly",
      },
    },
  },
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
