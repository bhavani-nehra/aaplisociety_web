// Minimal flat config. Its one job: keep raw fetch("/api/...") calls out of the client so every
// request goes through the interceptor (silent refresh, CSRF header, error contract).
export default [
  {
    files: ["app/**/*.{js,jsx,ts,tsx}", "components/**/*.{js,jsx,ts,tsx}"],
    ignores: ["app/api/**", "lib/api-fetch-interceptor.js", "lib/api-client.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: String.raw`CallExpression[callee.name='fetch'][arguments.0.value=/^\/api\//]`,
          message: 'Do not call fetch("/api/...") directly; use the API client / interceptor.',
        },
      ],
    },
  },
];
