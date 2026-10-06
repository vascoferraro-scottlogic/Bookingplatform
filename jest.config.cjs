/** @type {import('ts-jest').JestConfigWithTsJest} */
require("dotenv").config();

module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  setupFiles: ["<rootDir>/jest.setup.env.cjs"],
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
