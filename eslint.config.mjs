import reactHooks from "eslint-plugin-react-hooks";

// Minimal flat config. Its one job: keep raw fetch("/api/...") calls out of the client so every
// request goes through the interceptor (silent refresh, CSRF header, error contract).
// react-hooks plugin is registered (not just referenced) so inline
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments resolve instead of erroring.
export default [
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}"],
    ignores: ["app/api/**", "lib/api-fetch-interceptor.js", "lib/api-client.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: String.raw`CallExpression[callee.name='fetch'][arguments.0.value=/^\/api\//]`,
          message: 'Do not call fetch("/api/...") directly; use the API client / interceptor.',
        },
      ],
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
