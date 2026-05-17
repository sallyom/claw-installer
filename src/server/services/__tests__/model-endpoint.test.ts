import { describe, expect, it } from "vitest";
import {
  normalizeModelEndpointBaseUrl,
  normalizeModelEndpointModelsUrl,
  parseModelEndpointCatalog,
} from "../model-endpoint.js";

describe("normalizeModelEndpointBaseUrl", () => {
  it("appends /v1 when absent", () => {
    expect(normalizeModelEndpointBaseUrl("https://example.com/api")).toBe(
      "https://example.com/api/v1",
    );
  });

  it("keeps /v1 endpoints unchanged", () => {
    expect(normalizeModelEndpointBaseUrl("https://example.com/v1")).toBe(
      "https://example.com/v1",
    );
  });

  it("strips a direct /models suffix back to the API base", () => {
    expect(normalizeModelEndpointBaseUrl("https://example.com/v1/models")).toBe(
      "https://example.com/v1",
    );
  });

  it("trims repeated trailing slashes before suffix normalization", () => {
    expect(normalizeModelEndpointBaseUrl("https://example.com/v1/models///")).toBe(
      "https://example.com/v1",
    );
  });
});

describe("normalizeModelEndpointModelsUrl", () => {
  it("appends /models for /v1 endpoints", () => {
    expect(normalizeModelEndpointModelsUrl("https://example.com/v1")).toBe(
      "https://example.com/v1/models",
    );
  });

  it("appends /v1/models when /v1 is absent", () => {
    expect(normalizeModelEndpointModelsUrl("https://example.com/api")).toBe(
      "https://example.com/api/v1/models",
    );
  });
});

describe("parseModelEndpointCatalog", () => {
  it("extracts ids and names from OpenAI-compatible model payloads", () => {
    expect(parseModelEndpointCatalog({
      data: [
        { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
        { id: "llama-4-maverick", display_name: "Llama 4 Maverick" },
      ],
    })).toEqual([
      { id: "llama-4-scout-17b-16e-w4a16", name: "Llama 4 Scout 17B" },
      { id: "llama-4-maverick", name: "Llama 4 Maverick" },
    ]);
  });
});
