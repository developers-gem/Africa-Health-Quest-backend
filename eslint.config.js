import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "legacy/**",
      "apps/mobile/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error",
    },
  },
  {
    files: [
      "scripts/**",
      "apps/backend/src/scripts/**",
      "apps/backend/test/fixtures/mobile-e2e.ts",
      "packages/*/scripts/**",
    ],
    rules: { "no-console": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // Clinical answer keys must never reach client bundles.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@ahq/game-content",
              message: "game-content contains answer keys — backend only.",
            },
          ],
          patterns: [
            {
              group: ["**/game-content/**"],
              message: "game-content contains answer keys — backend only.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
