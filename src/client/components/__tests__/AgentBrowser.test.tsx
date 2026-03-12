import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AgentBrowser from "../AgentBrowser";

const sampleAgents = [
  { id: "lynx", path: "/agents/lynx", hasAgentsMd: true, hasJobMd: false, description: "A coding assistant" },
  { id: "hawk", path: "/agents/hawk", hasAgentsMd: true, hasJobMd: true, description: "A scheduled agent" },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("AgentBrowser", () => {
  it("shows loading state then agents list", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (url === "/api/agents/local") {
        return Promise.resolve({ json: () => Promise.resolve(sampleAgents) });
      }
      return Promise.resolve({ json: () => Promise.resolve([]) });
    }) as unknown as typeof globalThis.fetch;

    render(<AgentBrowser />);
    // Should eventually show agents
    await waitFor(() => {
      expect(screen.getByText("lynx")).toBeInTheDocument();
    });
    expect(screen.getByText("A coding assistant")).toBeInTheDocument();
    expect(screen.getByText("hawk")).toBeInTheDocument();
    // hawk has a scheduled job annotation
    expect(screen.getByText(/Has scheduled job/)).toBeInTheDocument();
  });

  it("shows empty state when no agents found", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ) as unknown as typeof globalThis.fetch;

    render(<AgentBrowser />);
    await waitFor(() => {
      expect(screen.getByText("No agents found")).toBeInTheDocument();
    });
  });

  it("renders git repo import form", () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve([]) }),
    ) as unknown as typeof globalThis.fetch;

    render(<AgentBrowser />);
    expect(screen.getByText("Import from Git Repository")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("https://github.com/org/agents-repo.git")).toBeInTheDocument();
    expect(screen.getByText("Browse")).toBeInTheDocument();
  });

  it("calls browse endpoint when Browse is clicked with URL", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/agents/local") {
        return Promise.resolve({ json: () => Promise.resolve([]) });
      }
      if (typeof url === "string" && url.startsWith("/api/agents/browse")) {
        return Promise.resolve({
          json: () => Promise.resolve([
            { id: "remote-agent", path: "/tmp/repo/agents/remote-agent", hasAgentsMd: true, hasJobMd: false, description: "Remote agent" },
          ]),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve([]) });
    }) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchMock;

    render(<AgentBrowser />);
    await waitFor(() => {
      expect(screen.getByText("No agents found")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("https://github.com/org/agents-repo.git");
    await user.type(input, "https://github.com/test/repo.git");
    await user.click(screen.getByText("Browse"));

    await waitFor(() => {
      expect(screen.getByText("remote-agent")).toBeInTheDocument();
    });
    expect(screen.getByText("Remote agent")).toBeInTheDocument();
  });

  it("renders gracefully when fetch rejects", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network error"))) as unknown as typeof globalThis.fetch;
    render(<AgentBrowser />);
    // Should not crash — finishes loading and shows empty state
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });

  it("shows 'No description' for agents without description", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve([
          { id: "bare", path: "/agents/bare", hasAgentsMd: false, hasJobMd: false },
        ]),
      }),
    ) as unknown as typeof globalThis.fetch;

    render(<AgentBrowser />);
    await waitFor(() => {
      expect(screen.getByText("No description")).toBeInTheDocument();
    });
  });
});
