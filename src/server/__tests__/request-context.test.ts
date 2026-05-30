import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../request-context.js";

describe("request context", () => {
  it("shares hosted user context across duplicate module loads", async () => {
    const duplicate = await import("../request-context.js?duplicate");

    const username = runWithRequestContext({
      hostedUser: {
        username: "sallyom",
        token: "token",
        groups: [],
      },
    }, () => duplicate.currentHostedUser()?.username);

    expect(username).toBe("sallyom");
  });
});
