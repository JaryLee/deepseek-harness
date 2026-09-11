import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { workspacePackageDirectories } from './workspace-packages.ts'

const roots: string[] = []

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-workspace-packages-'))
  roots.push(root)
  return root
}

function write(path: string, content = ''): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function manifest(root: string, directory: string, name: string): void {
  write(join(root, directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('workspacePackageDirectories', () => {
  it('selects manifest-owning package directories and skips residue of a deleted package', () => {
    const root = fixture()
    manifest(root, 'packages/core/agent', '@deepseek-ai/dsh-agent')
    manifest(root, 'vendor/loader', '@deepseek-ai/cordis-plugin-loader')
    manifest(root, 'apps/cli', '@deepseek-ai/dsh-cli')
    manifest(root, 'apps/web', '@deepseek-ai/dsh-web')
    write(join(root, 'packages/client/ghost/lib/types/index.js'), 'export {}\n')
    write(join(root, 'packages/client/ghost/node_modules/.bin/tool'))

    expect(workspacePackageDirectories(root, ['packages/*/*', 'vendor/*', 'apps/cli'])).toEqual([
      'apps/cli',
      'packages/core/agent',
      'vendor/loader',
    ])
  })

  it('skips a package manifest inside node_modules', () => {
    const root = fixture()
    manifest(root, 'packages/core/agent', '@deepseek-ai/dsh-agent')
    manifest(root, 'packages/core/node_modules', 'installed-dependency')

    expect(workspacePackageDirectories(root, ['packages/*/*'])).toEqual(['packages/core/agent'])
  })
})
