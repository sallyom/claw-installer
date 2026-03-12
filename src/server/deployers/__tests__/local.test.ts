import { describe, it, expect } from "vitest";
import { shouldAlwaysPull } from "../local.js";

describe("shouldAlwaysPull", () => {
  it("returns true for :latest tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:latest")).toBe(true);
  });

  it("returns true for image with no tag (implies :latest)", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw")).toBe(true);
  });

  it("returns true for simple image name with :latest", () => {
    expect(shouldAlwaysPull("nginx:latest")).toBe(true);
  });

  it("returns true for simple image name with no tag", () => {
    expect(shouldAlwaysPull("nginx")).toBe(true);
  });

  it("returns false for version-pinned tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:v2026.3.11")).toBe(false);
  });

  it("returns false for semver tag", () => {
    expect(shouldAlwaysPull("nginx:1.25.3")).toBe(false);
  });

  it("returns false for sha-based tag", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw:abc123")).toBe(false);
  });

  it("returns false for custom tag", () => {
    expect(shouldAlwaysPull("myregistry.io/app:staging")).toBe(false);
  });

  it("returns false for digest reference", () => {
    expect(shouldAlwaysPull("quay.io/sallyom/openclaw@sha256:abcdef1234567890")).toBe(false);
  });
});
