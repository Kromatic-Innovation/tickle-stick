import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// typescript-eslint's recommended TYPE-CHECKED rules (tickle-stick#251 F17).
// These need type information, so the parser is pointed at
// tsconfig.eslint.json, which widens the build tsconfig to cover test/ as
// well as src/. Any rule turned off or down below carries its reason.
const typeChecked = tsPlugin.configs["flat/recommended-type-checked"];

export default [
  js.configs.recommended,
  ...typeChecked.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "test/**/*.ts"],
  })),
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        performance: "readonly",
        Response: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        DOMException: "readonly",
        RequestInit: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Superseded by the TS-aware rule below.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Test-only relaxations. Each is a vitest idiom the type-checked rules
    // misread, not a defect, so they stay ON for src/:
    files: ["test/**/*.ts"],
    rules: {
      // vi.fn() mocks, the asymmetric matchers (expect.any(),
      // expect.objectContaining()) and JSON.parse of captured fixture output
      // are typed `any` by design; the assertions themselves are the checks.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      // `expect(storage.writeEvent).toHaveBeenCalled()` passes a mock method
      // reference without calling it, which is the standard vitest idiom.
      "@typescript-eslint/unbound-method": "off",
      // Mock implementations are declared `async` to model the async
      // provider contract (TriageProvider.classify returns a Promise) even
      // when the fake body never awaits.
      "@typescript-eslint/require-await": "off",
    },
  },
];
