import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'
import { workspacePackageDirectories } from './scripts/workspace-packages.ts'

/** Package parent patterns whose manifest-owning directories the ordinary build targets. */
const HOST_PACKAGE_PATTERNS = ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/desktop', 'apps/desktop-host']

/** The Client pass covers the same packages without the desktop applications. */
const CLIENT_PACKAGE_PATTERNS = ['vendor/*', 'packages/*/*', 'apps/cli']

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 *
 * Workspace targets are the manifest-owning directories under the invocation
 * directory, which is the root tsdown resolves workspace patterns against. A
 * directory without a package.json holds no package whose entry this
 * configuration could resolve, so it stays out of the build.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: workspacePackageDirectories(
      process.cwd(),
      client ? CLIENT_PACKAGE_PATTERNS : HOST_PACKAGE_PATTERNS,
    ),
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
