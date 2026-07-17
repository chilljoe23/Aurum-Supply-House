import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Node's built-in test runner (node:test) executes these directly with
      // TypeScript type-stripping; they import source with explicit .ts
      // extensions, which the app's bundler-resolution lint rules don't expect.
      "tests/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    // eslint-config-next 16 bundles eslint-plugin-react-hooks v6, whose new
    // React Compiler rules flag pre-existing, working M0–M2 idioms — memoized
    // sub-components, the next-themes-documented SSR mount guard, and the
    // xlsx / @tanstack/react-table libraries. These rules did not exist in the
    // Next 14 lint baseline. They are disabled to preserve the established
    // baseline and avoid unrelated product refactors; the classic hooks rules
    // (rules-of-hooks, exhaustive-deps) and all Next.js rules stay on as errors.
    rules: {
      "react-hooks/static-components": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
    },
  },
];

export default eslintConfig;
