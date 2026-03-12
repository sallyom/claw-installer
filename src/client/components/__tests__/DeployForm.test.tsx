import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeployForm from "../DeployForm";

const defaultHealth = {
  defaults: {
    hasAnthropicKey: false,
    hasOpenaiKey: false,
    hasTelegramToken: false,
    telegramAllowFrom: "",
    modelEndpoint: "",
    prefix: "testuser",
    image: "",
  },
  k8sAvailable: false,
  k8sContext: "",
  isOpenShift: false,
};

function mockFetchWith(health = defaultHealth, configs: unknown[] = []) {
  return vi.fn((url: string, opts?: RequestInit) => {
    if (url === "/api/health") {
      return Promise.resolve({ json: () => Promise.resolve(health) });
    }
    if (url === "/api/configs") {
      return Promise.resolve({ json: () => Promise.resolve(configs) });
    }
    if (url === "/api/configs/gcp-defaults") {
      return Promise.resolve({
        json: () => Promise.resolve({
          projectId: null, location: null,
          hasServiceAccountJson: false, credentialType: null, sources: {},
        }),
      });
    }
    if (url === "/api/deploy" && opts?.method === "POST") {
      return Promise.resolve({ json: () => Promise.resolve({ deployId: "deploy-123" }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  }) as unknown as typeof globalThis.fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("DeployForm", () => {
  it("renders initial form with mode selector, fields, and disabled deploy button", async () => {
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={vi.fn()} />);
    // Mode selector
    expect(screen.getByText("This Machine")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes / OpenShift")).toBeInTheDocument();
    expect(screen.getByText(/Remote Host/)).toBeInTheDocument();
    // Configuration section
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Agent Name")).toBeInTheDocument();
    // Deploy button disabled without agent name
    expect(screen.getByText("Deploy OpenClaw").closest("button")).toBeDisabled();
  });

  it("enables deploy button and auto-derives display name from agent name", async () => {
    const user = userEvent.setup();
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={vi.fn()} />);

    const agentInput = screen.getByPlaceholderText("e.g., lynx");
    await user.type(agentInput, "my-agent");

    expect(screen.getByText("Deploy OpenClaw").closest("button")).not.toBeDisabled();
    const displayInput = screen.getByPlaceholderText("e.g., Lynx") as HTMLInputElement;
    expect(displayInput.value).toBe("My agent");
  });

  it("calls onDeployStarted with deployId on successful deploy", async () => {
    const user = userEvent.setup();
    const onDeployStarted = vi.fn();
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={onDeployStarted} />);

    await user.type(screen.getByPlaceholderText("e.g., lynx"), "testbot");
    await user.click(screen.getByText("Deploy OpenClaw"));

    await waitFor(() => {
      expect(onDeployStarted).toHaveBeenCalledWith("deploy-123");
    });
  });

  it("switches inference provider and shows relevant fields", async () => {
    const user = userEvent.setup();
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={vi.fn()} />);

    expect(screen.getByText("Anthropic API Key")).toBeInTheDocument();

    const select = screen.getByDisplayValue("Anthropic");
    await user.selectOptions(select, "openai");
    expect(screen.getByText("OpenAI API Key")).toBeInTheDocument();
  });

  it("shows K8s unavailable warning when selecting Kubernetes mode", async () => {
    const user = userEvent.setup();
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={vi.fn()} />);

    const k8sCard = screen.getByText("Kubernetes / OpenShift").closest(".mode-card")!;
    await user.click(k8sCard);

    await waitFor(() => {
      expect(screen.getByText(/No Kubernetes cluster detected/)).toBeInTheDocument();
    });
    // Port field should not appear in K8s mode
    expect(screen.queryByText("Port")).not.toBeInTheDocument();
  });

  it("shows K8s context when cluster is available", async () => {
    const user = userEvent.setup();
    const health = { ...defaultHealth, k8sAvailable: true, k8sContext: "minikube" };
    globalThis.fetch = mockFetchWith(health);
    render(<DeployForm onDeployStarted={vi.fn()} />);

    const k8sCard = screen.getByText("Kubernetes / OpenShift").closest(".mode-card")!;
    await user.click(k8sCard);

    await waitFor(() => {
      expect(screen.getByText("minikube")).toBeInTheDocument();
    });
  });

  it("shows Telegram fields when checkbox is enabled", async () => {
    const user = userEvent.setup();
    globalThis.fetch = mockFetchWith();
    render(<DeployForm onDeployStarted={vi.fn()} />);

    expect(screen.queryByText("Telegram Bot Token")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Connect Telegram Bot"));

    expect(screen.getByText("Telegram Bot Token")).toBeInTheDocument();
    expect(screen.getByText("Allowed Telegram User IDs")).toBeInTheDocument();
  });

  it("detects env-provided Anthropic key from server defaults", async () => {
    const health = { ...defaultHealth, defaults: { ...defaultHealth.defaults, hasAnthropicKey: true } };
    globalThis.fetch = mockFetchWith(health);
    render(<DeployForm onDeployStarted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("(using key from environment)")).toBeInTheDocument();
    });
  });

  it("renders gracefully when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network error"))) as unknown as typeof globalThis.fetch;
    render(<DeployForm onDeployStarted={vi.fn()} />);
    // Should not crash — form still renders with defaults
    expect(screen.getByText("Deploy OpenClaw")).toBeInTheDocument();
  });
});
