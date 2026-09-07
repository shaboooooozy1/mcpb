export default {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    // The bin entry uses `import.meta`, which cannot be instrumented under the
    // CommonJS module setting ts-jest uses for tests. It is exercised via the
    // CLI subprocess tests instead.
    "!src/cli/cli.ts",
  ],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsConfig: "tsconfig.test.json",
      },
    ],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  // Floor to prevent coverage regressions. Ratchet these up as coverage grows;
  // never lower them to make a change pass.
  coverageThreshold: {
    global: {
      statements: 44,
      branches: 40,
      functions: 41,
      lines: 45,
    },
  },
};
