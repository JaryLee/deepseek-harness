# Agent Note: The workspace build treats a directory as a package only when it declares a manifest

Status: implemented

English | [中文](2026-09-11-workspace-build-requires-package-manifest.zh.md)

## Problem

`tsdown.config.ts` declared its workspace as directory patterns (`packages/*/*`, `vendor/*`, `apps/cli`), and tsdown resolves such a pattern to directories, so a directory left behind by a deleted package became a build target without owning a `package.json`. That directory inherits the root configuration, including its default `entry` of `lib/types/{index,invariant,startup}.js`; when the entry matches no file under the directory, the build aborts with `Cannot find entry`, labeled by the name tsdown reads from the nearest manifest above it, which is `@deepseek-ai/dsh-root` at the repository root. A residue directory that still held a `lib/types/index.js` from its deleted package passed the entry check instead and received bundles at its own `lib/`.

## Decision

`tsdown.config.ts` derives its workspace through `workspacePackageDirectories(process.cwd(), patterns)` in `scripts/workspace-packages.ts`, which returns the directories under its patterns that contain a `package.json` and drops every path inside `node_modules`. A directory without a manifest is not a workspace member, the membership rule pnpm applies, so the build neither targets it nor resolves a package entry against it. The enumeration root is the invocation directory, which is the directory tsdown resolves workspace patterns against when no `cwd` is passed. Removing stale directories stays with `pnpm run clean` ([TSC-first build](../process/2026-06-17-ts-build-config.md)), and the build still does not invoke clean.

## Alternatives considered

**Clean before every build.** Rejected by the [TSC-first build note](../process/2026-06-17-ts-build-config.md): it discards the incremental state owned by `tsc` and the bundler even when the workspace layout is unchanged.

**Exclude the residue directories by name.** Rejected: the residue is whatever the next deleted package leaves behind, and a directory exclusion cannot express `owns no package.json`.

**Fail the build on a pattern that matches a manifest-less directory.** Rejected: `pnpm run clean` owns that policy, including its refusal to delete unknown files, and manifest-less residue does not make an otherwise correct build wrong.

## Consequences

- Residue from a deleted package no longer aborts the build, and the build no longer writes bundles into that residue.
- `pnpm run clean` remains the only command that removes the residue, and it still refuses a manifest-less directory holding files outside `node_modules`, `lib`, `.typecheck`, and `*.tsbuildinfo`.
- A directory whose `package.json` is absent is not built. The built roster is manifest membership, so a package that loses its manifest disappears from the build rather than building under the repository-root name.

## Testing

`scripts/workspace-packages.spec.ts` covers selection of manifest-owning directories, residue with and without a stale `lib/types/index.js`, and a manifest inside `node_modules`. `pnpm run build` completes the Host and Client tsdown passes plus the Web build while a manifest-less directory holding a stale `lib/types/index.js` sits under `packages/`, and the `tsdown:config:workspace` debug channel lists the manifest-owning directories with no residue among them.
