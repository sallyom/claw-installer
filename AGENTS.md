# openclaw-installer Development Guide

## Pre-commit Checklist

Before committing, run the full CI validation locally:

```bash
npm run build    # Compiles server + provider plugins (catches type errors)
npm test         # Runs all vitest tests
npm run lint     # ESLint checks
```

`npm run build` is the most important -- it runs `tsc` with emit, which catches type errors that `--noEmit` or tsx may miss due to local `@types/node` version differences.

## Key Conventions

- ESM modules: all imports use `.js` extensions (TypeScript resolves `.ts` at build time)
- `vitest` for tests, in `__tests__/` directories next to source
- `tsx watch` for dev, `tsc` for production builds
- Provider plugins use relative imports back to `src/server/` (not `@openclaw/installer/*`)

## Scope Guard

The installer handles **Day 1 deployment only**. Features that can be performed
after deployment using the OpenClaw CLI (`openclaw <command>`) or the OpenClaw UI
must not be added to the installer. Before proposing a feature, ask: "Is this
needed on first launch?" If not, it belongs upstream. See
[ADR 0003](adr/0003-day-1-scope-boundary.md) for the full rationale and decision
framework.

## Build Configuration

- `tsconfig.server.json` -- compiles `src/server/` to `dist/`
- `tsconfig.provider-plugins.json` -- compiles `provider-plugins/*/src/` in-place (`.js` next to `.ts`)
- `vite.config.ts` -- builds the React frontend

## Testing

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Tests mock external dependencies (fetch, K8s API). See `src/server/deployers/__tests__/registry.test.ts` for conventions.

## Stopping the Dev Server

Do **not** use `lsof -i :port -t | xargs kill` to stop the dev server — this kills every process with a connection on that port, including the user's browser. Instead, target only node processes:

```bash
lsof -i :3000 -t -c node | xargs kill 2>/dev/null
lsof -i :3001 -t -c node | xargs kill 2>/dev/null
```
