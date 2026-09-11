/**
 * Workspace package discovery for the build configuration.
 * @module scripts/workspace-packages
 */

import { globSync } from 'node:fs'
import { dirname, sep } from 'node:path'

/** Package parent pattern resolved against the repository root, such as `packages/*\/*` or `apps/cli`. */
export type PackageDirectoryPattern = string

/**
 * Return the repository-relative directories under `patterns` that declare a package manifest.
 *
 * A directory is a package when it contains `package.json`, which is the workspace membership rule
 * pnpm applies; a directory left behind by a deleted package is not a workspace member, so the build
 * skips it instead of resolving a package entry against it. An installed `node_modules` is never a
 * package directory.
 * @param root - Repository root every pattern resolves against.
 * @param patterns - Package parent patterns.
 * @returns Sorted package directories in POSIX form, for example `packages/core/agent`.
 */
export function workspacePackageDirectories(
  root: string,
  patterns: readonly PackageDirectoryPattern[],
): string[] {
  const directories = new Set<string>()
  for (const pattern of patterns) {
    for (const manifest of globSync(`${pattern}/package.json`, { cwd: root })) {
      const directory = dirname(manifest).split(sep).join('/')
      if (directory.split('/').includes('node_modules')) continue
      directories.add(directory)
    }
  }
  return [...directories].sort()
}
