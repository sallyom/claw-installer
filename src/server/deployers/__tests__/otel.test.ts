import { describe, expect, it } from "vitest";
import { generateOtelConfig, generateOtelConfigObject } from "../otel.js";
import type { DeployConfig } from "../types.js";

describe("otel config generation", () => {
  it("renders MLflow OTLP HTTP config with experiment header", () => {
    const config: DeployConfig = {
      mode: "kubernetes",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "http://mlflow-service.mlflow.svc.cluster.local:5000",
      otelExperimentId: "42",
    };

    const objectConfig = generateOtelConfigObject(config);
    const yamlConfig = generateOtelConfig(config);

    expect(objectConfig).toMatchObject({
      exporters: {
        otlphttp: {
          endpoint: "http://mlflow-service.mlflow.svc.cluster.local:5000",
          headers: {
            "x-mlflow-experiment-id": "42",
          },
        },
      },
      service: {
        pipelines: {
          traces: {
            exporters: ["otlphttp", "debug"],
          },
        },
      },
    });

    expect(yamlConfig).toContain("otlphttp:");
    expect(yamlConfig).toContain("x-mlflow-experiment-id: 42");
  });
});
