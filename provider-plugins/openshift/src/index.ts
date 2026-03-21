import type { InstallerPlugin } from "../../../src/server/deployers/registry.js";
import { OpenShiftDeployer } from "./openshift-deployer.js";
import { isOpenShift } from "./detection.js";

export { OpenShiftDeployer } from "./openshift-deployer.js";
export { isOpenShift } from "./detection.js";
export { applyRoute, getRouteUrl, deleteRoute } from "./route.js";
export { oauthProxyContainer, oauthServiceAccount, oauthConfigSecret } from "./oauth-proxy.js";

/**
 * Plugin registration object.
 *
 * When openclaw-installer loads this plugin, it calls register() to add
 * the "openshift" deploy mode to the deployer registry.
 *
 * The detect() function probes the cluster for the route.openshift.io API
 * group. When detected, the installer can auto-select this deployer.
 */
const plugin = {
  register(registry) {
    registry.register({
      mode: "openshift",
      title: "OpenShift",
      description: "Deploy to an OpenShift cluster with OAuth proxy and Routes",
      deployer: new OpenShiftDeployer(),
      detect: isOpenShift,
      priority: 10,
    });
  },
} satisfies InstallerPlugin;

export default plugin;
