/** @type {import('ts-jest').JestConfigWithTsJest} */
// Unit tests only: .env is deliberately not loaded and the database is blocked
// (see jest.setup.env.cjs and jest.setup.db-guard.ts).
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  setupFiles: ["<rootDir>/jest.setup.env.cjs"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.db-guard.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          rootDir: ".",
          ignoreDeprecations: "6.0",
        },
      },
    ],
  },
};
