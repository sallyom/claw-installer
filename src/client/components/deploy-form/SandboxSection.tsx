import React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { DeployFormConfig } from "./types.js";

interface SandboxSectionProps {
  config: DeployFormConfig;
  isClusterMode: boolean;
  isLocalMode: boolean;
  update: (field: string, value: string) => void;
  setConfig: Dispatch<SetStateAction<DeployFormConfig>>;
}

export function SandboxSection({ config, isClusterMode, isLocalMode, update, setConfig }: SandboxSectionProps) {
  const supportsOpenShell = isClusterMode || isLocalMode;
  const backend = supportsOpenShell ? config.sandboxBackend : "ssh";

  return (
    <>
      <h3 style={{ marginTop: "1.5rem" }}>Sandbox</h3>

      <div className="form-group">
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={config.sandboxEnabled}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, sandboxEnabled: e.target.checked }))
            }
          />
          Enable sandbox backend
        </label>
        <div className="hint">
          Use SSH for an existing remote host, or OpenShell for managed sandboxes.
        </div>
      </div>

      {config.sandboxEnabled && (
        <>
          <div className="form-row">
            {supportsOpenShell && (
              <div className="form-group">
                <label>Sandbox Backend</label>
                <select
                  value={config.sandboxBackend}
                  onChange={(e) => update("sandboxBackend", e.target.value)}
                >
                  <option value="openshell">OpenShell</option>
                  <option value="ssh">SSH</option>
                </select>
                <div className="hint">
                  {isLocalMode
                    ? "For local deploys, start an OpenShell gateway with the Podman driver first."
                    : "Choose OpenShell only when a cluster admin has provisioned an OpenShell gateway for this user or namespace."}
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Sandbox Mode</label>
              <select
                value={config.sandboxMode}
                onChange={(e) => update("sandboxMode", e.target.value)}
              >
                <option value="all">All agent sessions</option>
                <option value="non-main">Non-main sessions only</option>
                <option value="off">Off</option>
              </select>
              <div className="hint">
                Use non-main to let the manager run on the gateway while worker sessions run in the sandbox.
              </div>
            </div>
          </div>

          {backend === "openshell" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>OpenShell Gateway Endpoint</label>
                  <input
                    type="text"
                    placeholder={isLocalMode
                      ? "https://localhost:18080"
                      : "http://openshell-alice.openshell-alice.svc.cluster.local:8080"}
                    value={config.sandboxOpenShellGatewayEndpoint}
                    onChange={(e) => update("sandboxOpenShellGatewayEndpoint", e.target.value)}
                  />
                  <div className="hint">
                    {isLocalMode
                      ? "Host URL for the local OpenShell gateway. Localhost is rewritten for the OpenClaw container."
                      : "Cluster-internal URL for the user's admin-provisioned OpenShell gateway service."}
                  </div>
                </div>
                <div className="form-group">
                  <label>OpenShell Workspace Mode</label>
                  <select
                    value={config.sandboxOpenShellMode}
                    onChange={(e) => update("sandboxOpenShellMode", e.target.value)}
                  >
                    <option value="remote">remote</option>
                    <option value="mirror">mirror</option>
                  </select>
                  <div className="hint">
                    Remote matches the OpenShell lab: the sandbox owns workspace state after its initial seed.
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label>OpenShell Sandbox Source</label>
                <input
                  type="text"
                  placeholder="quay.io/sallyom/openclaw-openshell:latest"
                  value={config.sandboxOpenShellFrom}
                  onChange={(e) => update("sandboxOpenShellFrom", e.target.value)}
                />
                <div className="hint">
                  The default is the multi-arch OpenClaw 2026.7.1 UBI build validated with this installer. Bare names resolve through the OpenShell sandbox registry.
                </div>
              </div>

              {isLocalMode && (
                <>
                  <div className="form-group">
                    <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={config.sandboxOpenShellWorkerEnabled}
                        onChange={(e) =>
                          setConfig((prev) => ({ ...prev, sandboxOpenShellWorkerEnabled: e.target.checked }))
                        }
                      />
                      Enable OpenShell WorkerProvider (WIP)
                    </label>
                    <div className="hint">
                      Adds an <code>openshell</code> cloud-worker profile. Use only with the OpenClaw
                      WIP image and an OpenShell Gateway built with reverse Unix-socket forwarding.
                    </div>
                  </div>

                  {config.sandboxOpenShellWorkerEnabled && (
                    <>
                      <div className="form-group">
                        <label>OpenShell WIP CLI binary on this host</label>
                        <input
                          type="text"
                          placeholder="/path/to/openshell"
                          value={config.sandboxOpenShellCliHostPath}
                          onChange={(e) => update("sandboxOpenShellCliHostPath", e.target.value)}
                        />
                        <div className="hint">
                          The installer copies this modified Linux CLI into the OpenClaw state volume. The
                          default public OpenShell CLI does not include the WIP policy contract.
                        </div>
                      </div>

                      <div className="form-group">
                        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={config.sandboxOpenShellInferenceLocalEnabled}
                            onChange={(e) =>
                              setConfig((prev) => ({
                                ...prev,
                                sandboxOpenShellInferenceLocalEnabled: e.target.checked,
                              }))
                            }
                          />
                          Use configured OpenShell inference.local (WIP)
                        </label>
                        <div className="hint">
                          OpenShell credentials and its Gateway-wide inference route remain external to the
                          installer. This worker profile verifies that route before provisioning.
                        </div>
                      </div>

                      {config.sandboxOpenShellInferenceLocalEnabled && (
                        <>
                          <div className="form-row">
                            <div className="form-group">
                              <label>OpenShell inference provider</label>
                              <input
                                type="text"
                                placeholder="anthropic"
                                value={config.sandboxOpenShellInferenceProvider}
                                onChange={(e) => update("sandboxOpenShellInferenceProvider", e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>OpenShell inference model</label>
                              <input
                                type="text"
                                placeholder="claude-sonnet-4-5"
                                value={config.sandboxOpenShellInferenceModel}
                                onChange={(e) => update("sandboxOpenShellInferenceModel", e.target.value)}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group">
                              <label>OpenClaw provider for this model</label>
                              <input
                                type="text"
                                placeholder="anthropic"
                                value={config.sandboxOpenShellInferenceOpenClawProvider}
                                onChange={(e) => update("sandboxOpenShellInferenceOpenClawProvider", e.target.value)}
                              />
                            </div>
                            <div className="form-group">
                              <label>inference.local API</label>
                              <select
                                value={config.sandboxOpenShellInferenceApi}
                                onChange={(e) => update("sandboxOpenShellInferenceApi", e.target.value)}
                              >
                                <option value="anthropic-messages">Anthropic Messages</option>
                                <option value="openai-responses">OpenAI Responses</option>
                                <option value="openai-completions">OpenAI Completions</option>
                              </select>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Sandbox Scope</label>
              <select
                value={config.sandboxScope}
                onChange={(e) => update("sandboxScope", e.target.value)}
              >
                <option value="session">session</option>
                <option value="agent">agent</option>
                <option value="shared">shared</option>
              </select>
            </div>
            <div className="form-group">
              <label>Workspace Access</label>
              <select
                value={config.sandboxWorkspaceAccess}
                onChange={(e) => update("sandboxWorkspaceAccess", e.target.value)}
              >
                <option value="rw">rw</option>
                <option value="ro">ro</option>
                <option value="none">none</option>
              </select>
            </div>
          </div>

          {backend === "ssh" && (
            <div className="form-group">
              <label>Remote Workspace Root</label>
              <input
                type="text"
                placeholder="/tmp/openclaw-sandboxes"
                value={config.sandboxSshWorkspaceRoot}
                onChange={(e) => update("sandboxSshWorkspaceRoot", e.target.value)}
              />
            </div>
          )}

          <div className="form-group">
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={config.sandboxToolPolicyEnabled}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, sandboxToolPolicyEnabled: e.target.checked }))
                }
              />
              Customize sandbox tool baseline
            </label>
            <div className="hint">
              Optional persistent baseline for sandboxed tools. This is intentionally much smaller than the full gateway UI.
            </div>
          </div>

          {config.sandboxToolPolicyEnabled && (
            <div className="form-row" style={{ flexWrap: "wrap", gap: "1rem 1.5rem", marginBottom: "1rem" }}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowFiles}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowFiles: e.target.checked }))
                  }
                />
                File tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowSessions}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowSessions: e.target.checked }))
                  }
                />
                Session tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowMemory}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowMemory: e.target.checked }))
                  }
                />
                Memory tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowRuntime}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowRuntime: e.target.checked }))
                  }
                />
                Runtime tools (`exec`, `bash`, `process`)
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowBrowser}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowBrowser: e.target.checked }))
                  }
                />
                Browser and canvas
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowAutomation}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowAutomation: e.target.checked }))
                  }
                />
                Automation tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowMessaging}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowMessaging: e.target.checked }))
                  }
                />
                Messaging tools
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={config.sandboxToolAllowWebFetch}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, sandboxToolAllowWebFetch: e.target.checked }))
                  }
                />
                Gateway web fetch
              </label>
            </div>
          )}

          {backend === "ssh" && (
            <>
              <div className="form-group">
                <label>SSH Target</label>
                <input
                  type="text"
                  placeholder="user@gateway-host:22"
                  value={config.sandboxSshTarget}
                  onChange={(e) => update("sandboxSshTarget", e.target.value)}
                />
                <div className="hint">
                  Required. OpenClaw will run sandboxed tools on this remote host.
                </div>
              </div>

              <div className="form-row">
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxSshStrictHostKeyChecking}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        sandboxSshStrictHostKeyChecking: e.target.checked,
                      }))}
                  />
                  Strict host key checking
                </label>
                <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={config.sandboxSshUpdateHostKeys}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        sandboxSshUpdateHostKeys: e.target.checked,
                      }))}
                  />
                  Update host keys
                </label>
              </div>

              <div className="form-group">
                <label>SSH Private Key</label>
                <input
                  type="text"
                  placeholder="/path/to/id_ed25519"
                  value={config.sandboxSshIdentityPath}
                  onChange={(e) => update("sandboxSshIdentityPath", e.target.value)}
                />
                <div className="hint">Path on the installer host to the private key file.</div>
              </div>

              <div className="form-group">
                <label>
                  SSH Certificate
                  <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                    {" "}(optional)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="/path/to/id_ed25519-cert.pub"
                  value={config.sandboxSshCertificatePath}
                  onChange={(e) => update("sandboxSshCertificatePath", e.target.value)}
                  style={{ marginBottom: "0.5rem" }}
                />
                <textarea
                  rows={4}
                  placeholder="ssh-ed25519-cert-v01@openssh.com ..."
                  value={config.sandboxSshCertificate}
                  onChange={(e) => update("sandboxSshCertificate", e.target.value)}
                />
                <div className="hint">Type a path on the installer host, or paste the certificate directly.</div>
              </div>

              <div className="form-group">
                <label>
                  Known Hosts
                  <span style={{ color: "var(--text-secondary)", fontWeight: "normal" }}>
                    {" "}(optional)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="/path/to/known_hosts"
                  value={config.sandboxSshKnownHostsPath}
                  onChange={(e) => update("sandboxSshKnownHostsPath", e.target.value)}
                  style={{ marginBottom: "0.5rem" }}
                />
                <textarea
                  rows={4}
                  placeholder="gateway-host ssh-ed25519 AAAA..."
                  value={config.sandboxSshKnownHosts}
                  onChange={(e) => update("sandboxSshKnownHosts", e.target.value)}
                />
                <div className="hint">Type a path on the installer host, or paste known_hosts entries directly.</div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
