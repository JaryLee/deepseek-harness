# Agent Note: The client tsdown preset locates the repository root from the invocation directory

Status: implemented

English | [中文](2026-08-28-client-config-repository-root.zh.md)

## Problem

`packages/client/tsdown.client.ts` derived `REPOSITORY_ROOT` as two directory levels above `import.meta.url`, which is correct only while the module evaluates from its own source file. tsdown loads package configs through unrun, which bundles the config into `node_modules/.unrun` and rewrites `import.meta.url`; depending on the module content that rewrite settles on the entry config's file, the inlined module's file, or the bundled output file, all at different depths. When the entry-config value wins, the derivation lands on `<repo>/packages/` instead of the repository root, `workspaceManifest`'s `packages/*/*/package.json` glob matches nothing, and every client-preset package build aborts with `tsdown: no packages/*/*/package.json declares the name …`. `browserSourcePath` silently rebases client sourcemaps against the same wrong root.

## Decision

`REPOSITORY_ROOT` now ascends from the process working directory to the nearest ancestor owning `pnpm-workspace.yaml`. tsdown runs workspace builds from the repository root and focused single-package builds from the package directory, so both invocation contexts ascend to the same root, and `pnpm-workspace.yaml` exists only at that root because the repository defines one workspace. A checkout invoked from outside the repository fails loud at config evaluation instead of globbing an unrelated directory.

## Alternatives considered

**Walk up from `import.meta.url` instead of `process.cwd()`.** Rejected because unrun's rewrite makes the value content- and version-dependent; any fixed number of parent levels from it stays fragile across unrun releases.

**Inject the root through an environment variable set by `scripts/build.ts`.** Rejected because the preset also evaluates under direct `tsdown` invocations, such as focused package builds, where no orchestration is present to set the variable.

**Search upward for `tsconfig.host.json`.** Rejected because every member package carries its own face configs, so the first match above a package directory is the package itself rather than the repository root.

## Consequences

- `workspaceManifest` resolves every workspace package manifest again, in workspace and focused builds alike, so the host and client passes bundle client-preset packages without the missing-manifest abort.
- `browserSourcePath` rebases browser sourcemap sources against a stable root in both invocation contexts.
- Running the preset from a directory outside the repository throws at config evaluation rather than emitting mis-rebased artifacts.

## Testing

The repository build exercises the derivation end to end: `pnpm run build` completes the host and client tsdown passes plus the web frontend, and `pnpm exec tsdown --env.DSH_BUILD_FACE host` inside `packages/api/remotes` — the invocation that reproduced the missing-manifest abort — completes on Windows.
