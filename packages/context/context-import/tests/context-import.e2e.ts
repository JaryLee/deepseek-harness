import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

// The driver and its overlay live beside this suite so the smoke boots the
// shipped headless bundle layers — the same topology a deployed profile uses —
// with only the subject plugin and a deterministic model added.
const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/context-import.patch.yml', import.meta.url))
const repoTsconfig = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))
const rollout = fileURLToPath(new URL('./fixtures/codex/rollout-a.jsonl', import.meta.url))

/** One `IMPORTED` reading from the driver's stdout. */
interface ImportReading {
  readonly events: number
  readonly messages: number
  readonly dropped: number
  readonly foreign: number
}

/**
 * Parse the driver's summary line.
 * @param stdout - Complete driver stdout.
 * @returns The reading, or `undefined` when the driver printed none.
 */
function reading(stdout: string): ImportReading | undefined {
  const line = stdout.split('\n').find(candidate => candidate.startsWith('IMPORTED '))
  const matched = /^IMPORTED events=(\d+) messages=(\d+) dropped=(\d+) foreign=(\d+)$/u.exec(line ?? '')
  if (matched === null) return undefined
  return {
    events: Number(matched[1]),
    messages: Number(matched[2]),
    dropped: Number(matched[3]),
    foreign: Number(matched[4]),
  }
}

describe('context-import through the production headless profile', () => {
  it('imports a Codex rollout as a seeded session and derives its messages', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'context-import headless smoke',
      tempDirPrefix: 'context-import-e2e-',
      binScript: driver,
      libBinScript: driver,
      configPath,
      tsconfigPath: repoTsconfig,
      env: { CONTEXT_IMPORT_FIXTURE: rollout },
    })

    expect(stderr).not.toContain('UNHANDLED')
    const imported = reading(stdout)
    expect(imported).toBeDefined()
    expect(imported!.events).toBeGreaterThan(0)
    expect(imported!.messages).toBeGreaterThan(0)
    expect(imported!.dropped).toBe(0)
    // The listing reads the configured roots, which are this machine's own
    // foreign logs: only its type is pinned.
    expect(Number.isInteger(imported!.foreign)).toBe(true)
    expect(imported!.foreign).toBeGreaterThanOrEqual(0)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
