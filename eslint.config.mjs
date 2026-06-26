import next from "eslint-config-next";
import reactHooks from "eslint-plugin-react-hooks";

// Next 16 ships native flat config (an array of config objects). Spread it,
// then layer our ignores + rule tuning. ESLint 9.
const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "release/**",
      "dist/**",
      "node_modules/**",
      // Capacitor copies the compiled Next bundle here. It is generated output,
      // not source; linting it re-lints minified Turbopack chunks and fails on
      // framework internals like `module` assignments.
      "ios/App/App/public/**",
      "electron/**/*.cjs",
      "next-env.d.ts",
    ],
  },
  ...next,
  {
    // Re-register the react-hooks plugin so we can tune its rules. Next 16
    // bundles the react-compiler-era rules as hard errors. The set-state-in-effect
    // check fires on this app's intentional load-on-mount/polling effects; keep the
    // actionable compiler checks as warnings, but do not fail the repo on that pattern.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
];

export default config;
