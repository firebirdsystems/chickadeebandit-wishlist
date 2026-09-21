import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The page imports the hub SDK by absolute URL, which only exists when the
  // hub serves it. Point it at a stub so index.html can actually be executed
  // in a test — see __tests__/boot.test.mjs.
  resolve: {
    alias: {
      "/hub-sdk.js": fileURLToPath(new URL("./__tests__/helpers/hub-sdk-stub.mjs", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/**/*.{test,spec}.{js,mjs}"],
  },
});
