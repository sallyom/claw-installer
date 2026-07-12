# MCP Apps Showcase

This Agent Source Directory configures seven official
[MCP Apps examples](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples)
for OpenClaw:

| Server | What it demonstrates |
| --- | --- |
| `system-monitor` | Live per-core CPU and memory charts, automatic polling, and an app-only tool |
| `budget-allocator` | Interactive sliders, a donut chart, trends, and benchmark comparisons |
| `customer-segmentation` | An interactive customer bubble chart with selectable metrics, segment filters, and detail views |
| `map` | A searchable 3D globe with rotation, zoom, and OpenStreetMap imagery |
| `cohort-heatmap` | Color-coded retention cohorts with metric switching, tooltips, and highlighting |
| `sheet-music` | Rendered ABC sheet music with interactive audio playback and looping |
| `shadertoy` | Real-time ShaderToy-compatible GLSL fragment shaders with mouse and touch input |

The servers are published by the MCP project and run over stdio with `npx`. No
custom server code or API key is required.

## Deploy

1. Start the installer with `./run.sh`.
2. Set **Agent Source Directory** to `demos/mcp-apps-example`.
3. Select an OpenClaw image containing MCP Apps support, such as
   `quay.io/sallyom/openclaw:latest`.
4. Deploy and open a fresh Control UI chat.

The demo's `mcp.json` enables MCP Apps for the deployment automatically.

The first use of each server downloads its package or Python dependencies, so
startup can take longer than later calls.

## Try each App

### System monitor

Ask:

> Show me the live system monitor.

The `get-system-info` result should render an inline dashboard that updates every
two seconds through the app-only `poll-system-stats` tool. In a container or pod,
the dashboard describes that container's visible operating-system environment,
not necessarily the physical host.

### Budget allocator

Ask:

> Open an interactive $250,000 Series A budget allocator.

The `get-budget-data` result should render sliders and charts. Adjust allocations
and confirm the total and visualization update without another model turn.

### Customer segmentation

Ask:

> Show me the interactive customer segmentation explorer.

The `get-customer-data` result should render 250 generated customers grouped by
segment. Change the chart axes, toggle segments, and select a customer to inspect
its details.

### Map

Ask:

> Find the Eiffel Tower and show it on the interactive map.

The agent should call `geocode` and then `show-map`. The App loads CesiumJS and
OpenStreetMap data from the domains declared by its CSP, so it requires outbound
internet access from the browser.

### Cohort heatmap

Ask:

> Show an interactive monthly retention heatmap for 12 cohorts.

The `get-cohort-data` result should render a color-coded grid. Switch metrics,
hover for exact values, and click cells to highlight their row and column.

### Sheet music

Ask:

> Write a short cheerful melody in C major and show me playable sheet music.

The agent should call `play-sheet-music` with valid ABC notation. The result
should display the score with play, pause, and loop controls.

### ShaderToy

Ask:

> Render an animated, mouse-responsive neon kaleidoscope shader.

The agent should call `render-shadertoy` with a ShaderToy-compatible fragment
shader. The result should animate in real time and respond to pointer input.

## Troubleshooting

- Confirm the Agent Source `mcp.json` contains `"mcpAppsEnabled": true`.
- Local Podman/Docker deployments need both `18789` and `18790` published.
- Kubernetes manual access needs
  `kubectl port-forward svc/openclaw 18789:18789 18790:18790 -n <namespace>`.
- `curl -i http://127.0.0.1:18790/mcp-app-sandbox` should return `200` locally.
- Check Gateway logs for `bundle-mcp` or `mcp-app` errors if a normal tool result
  appears without an inline App.

MCP Apps are enabled globally for the instance. Use this demo with an isolated
test deployment or only alongside other MCP servers you trust.
