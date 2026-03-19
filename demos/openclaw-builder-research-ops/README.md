# Builder Research Ops Demo

This demo is an `Agent Source Directory` bundle for `claw-installer`.

It provisions:

- a main orchestrator agent from `workspace-main/`
- a `builder` agent with sandboxed runtime and file tools
- a `research` agent with file and memory tools
- an `ops` agent with file, memory, and automation tools

## How to use it

1. Open `claw-installer`
2. Set `Agent Source Directory` to this folder
3. Enable the SSH sandbox backend
4. Deploy as usual

Recommended for first use:

- `Sandbox Mode`: `all`
- `Sandbox Scope`: `session`
- `Workspace Access`: `rw`

The bundle uses `openclaw-agents.json` to register the extra named agents and
their per-agent sandbox tool policies.

The main agent is configured to allow these spawn targets:

- `builder`
- `research`
- `ops`
