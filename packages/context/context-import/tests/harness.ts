/**
 * Shared inputs for the context-import suites: checked-in foreign logs plus
 * temporary roots whose file layout the listing tests control exactly.
 */

import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ForeignTranscript } from '../src/types.ts'

/**
 * Absolute path of one checked-in fixture.
 * @param name - Path below `tests/fixtures`, with `/` separators.
 * @returns The absolute fixture path.
 */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

/** A temporary directory owned by one suite, removed when the suite finishes. */
export interface TempRoot {
  /** Absolute path of the directory. */
  readonly path: string
  /**
   * Write one JSONL file into the root.
   * @param name - File name, relative to the root.
   * @param lines - Iterated values, each serialized as one JSON line; strings are written verbatim.
   * @returns The absolute path of the written file.
   */
  write(name: string, lines: readonly unknown[]): Promise<string>
  /**
   * Stamp one file's access and modification times.
   * @param path - File to stamp.
   * @param at - Exact modification time.
   */
  stamp(path: string, at: Date): Promise<void>
}

/** Every temporary root this module created, removed by {@link removeTempRoots}. */
const roots: TempRoot[] = []

/**
 * Create a temporary root for one test file.
 * @param prefix - Diagnostic prefix for the directory name.
 * @returns The root, with JSONL and timestamp helpers.
 */
export async function tempRoot(prefix: string): Promise<TempRoot> {
  const path = await mkdtemp(join(tmpdir(), `context-import-${prefix}-`))
  const root: TempRoot = {
    path,
    async write(name, lines) {
      const target = join(path, name)
      await mkdir(dirname(target), { recursive: true })
      const body = lines.map(line => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')
      await writeFile(target, `${body}\n`, 'utf8')
      return target
    },
    async stamp(target, at) {
      await utimes(target, at, at)
    },
  }
  roots.push(root)
  return root
}

/** Remove every temporary root created through {@link tempRoot}. */
export async function removeTempRoots(): Promise<void> {
  const owned = roots.splice(0)
  await Promise.all(owned.map(async (root) => {
    await rm(root.path, { recursive: true, force: true })
  }))
}

/**
 * Build a transcript by hand, with only the fields a test cares about.
 * @param entries - Conversation entries in foreign order.
 * @param overrides - Transcript fields to replace.
 * @returns The assembled transcript.
 */
export function transcript(
  entries: ForeignTranscript['entries'],
  overrides: Partial<ForeignTranscript> = {},
): ForeignTranscript {
  return {
    tool: 'codex',
    sessionId: 'sess',
    sourcePaths: ['/foreign/rollout.jsonl'],
    entries,
    skipped: [],
    ...overrides,
  }
}
