import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "server",
          environment: "node",
          include: ["src/server/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/client/**/*.test.tsx"],
          setupFiles: ["src/client/test-setup.ts"],
        },
      },
    ],
  },
});
