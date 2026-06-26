import { describe, expect, it } from "vitest";
import { generateOtelConfig, generateOtelConfigObject, formatScalar } from "../otel.js";
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
            "x-mlflow-workspace": "default",
          },
          auth: { authenticator: "bearertokenauth" },
        },
      },
      extensions: {
        bearertokenauth: {
          filename: "/var/run/secrets/kubernetes.io/serviceaccount/token",
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
    expect(yamlConfig).toContain('x-mlflow-experiment-id: "42"');
  });

  it("does not register bearertokenauth on kubernetes without experiment ID", () => {
    const config: DeployConfig = {
      mode: "kubernetes",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "http://mlflow-service.mlflow.svc.cluster.local:5000",
    };

    const objectConfig = generateOtelConfigObject(config);
    const otlphttp = (objectConfig.exporters as Record<string, unknown>).otlphttp as Record<string, unknown>;

    expect(objectConfig).not.toHaveProperty("extensions");
    expect(otlphttp).not.toHaveProperty("auth");
    expect(otlphttp).not.toHaveProperty("headers");
  });

  it("skips OTLP HTTP TLS verification only when explicitly enabled", () => {
    const baseConfig: DeployConfig = {
      mode: "kubernetes",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "https://mlflow-service.mlflow.svc.cluster.local:5000",
    };

    const defaultConfig = generateOtelConfigObject(baseConfig);
    const defaultExporter = (defaultConfig.exporters as Record<string, unknown>).otlphttp as Record<string, unknown>;
    expect(defaultExporter.tls).not.toHaveProperty("insecure_skip_verify");

    const skipVerifyConfig = generateOtelConfigObject({ ...baseConfig, otelTlsSkipVerify: true });
    const skipVerifyExporter = (skipVerifyConfig.exporters as Record<string, unknown>).otlphttp as Record<string, unknown>;
    expect(skipVerifyExporter.tls).toMatchObject({ insecure_skip_verify: true });
  });

  it("sets ca_file on openshift with HTTPS endpoint and no skip verify", () => {
    const config: DeployConfig = {
      mode: "openshift",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "https://mlflow.apps.cluster.example.com",
    };

    const obj = generateOtelConfigObject(config);
    const tls = (
      (obj.exporters as Record<string, Record<string, unknown>>).otlphttp
        .tls as Record<string, unknown>
    );

    expect(tls).not.toHaveProperty("insecure_skip_verify");
    expect(tls.ca_file).toBe("/etc/pki/tls/service-ca/service-ca.crt");
  });

  it("skips ca_file when otelTlsSkipVerify is true on openshift", () => {
    const config: DeployConfig = {
      mode: "openshift",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "https://mlflow.apps.cluster.example.com",
      otelTlsSkipVerify: true,
    };

    const obj = generateOtelConfigObject(config);
    const tls = (
      (obj.exporters as Record<string, Record<string, unknown>>).otlphttp
        .tls as Record<string, unknown>
    );

    expect(tls.insecure_skip_verify).toBe(true);
    expect(tls).not.toHaveProperty("ca_file");
  });

  it("does not set ca_file on non-openshift HTTPS endpoints", () => {
    const config: DeployConfig = {
      mode: "kubernetes",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "https://mlflow.example.com",
    };

    const obj = generateOtelConfigObject(config);
    const tls = (
      (obj.exporters as Record<string, Record<string, unknown>>).otlphttp
        .tls as Record<string, unknown>
    );

    expect(tls).not.toHaveProperty("ca_file");
  });

  it("does not set ca_file for non-HTTPS endpoints on openshift", () => {
    const config: DeployConfig = {
      mode: "openshift",
      agentName: "alpha",
      agentDisplayName: "Alpha",
      otelEnabled: true,
      otelEndpoint: "http://mlflow.mlflow.svc:5000",
    };

    const obj = generateOtelConfigObject(config);
    const tls = (
      (obj.exporters as Record<string, Record<string, unknown>>).otlphttp
        .tls as Record<string, unknown>
    );

    expect(tls.insecure).toBe(true);
    expect(tls).not.toHaveProperty("ca_file");
  });
});

describe("formatScalar", () => {
  it("renders regular strings bare", () => {
    expect(formatScalar("otlp")).toBe("otlp");
  });

  it("quotes numeric strings", () => {
    expect(formatScalar("42")).toBe('"42"');
    expect(formatScalar("3.14")).toBe('"3.14"');
  });

  it("quotes strings with special characters", () => {
    expect(formatScalar("hello world")).toBe('"hello world"');
    expect(formatScalar("key: value")).toBe('"key: value"');
  });

  it("renders booleans bare", () => {
    expect(formatScalar(true)).toBe("true");
    expect(formatScalar(false)).toBe("false");
  });

  it("renders numbers bare", () => {
    expect(formatScalar(100)).toBe("100");
    expect(formatScalar(3.14)).toBe("3.14");
  });
});
