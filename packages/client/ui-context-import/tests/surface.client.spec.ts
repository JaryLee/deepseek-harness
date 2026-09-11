/**
 * The per-Session import surface: the listing read, the filter, search, and
 * page inputs, and both import verbs against a stubbed commands Remote.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { ImportSurface, selectPage, type ImportDialogState } from '../src/client/surface.ts'
import { IMPORT_LIST_HEADER, type ImportRow } from '../src/client/rows.ts'

const SESSION = 'session' as SessionId

/** One listing row, as the Host renders it. */
function rowLine(tool: string, id: string, title?: string): string {
  const named = title === undefined ? '' : `, ${JSON.stringify(title)}`
  return `${tool} ${id}  (/work, 2026-02-03T04:05:06.000Z, 4 KiB${named})`
}

/** A `/import list` result text: header plus the given rows. */
function listing(...lines: string[]): string {
  return [IMPORT_LIST_HEADER, ...lines].join('\n')
}

/** One parsed row, spelled out for assertion readability. */
function row(over: Partial<ImportRow> = {}): ImportRow {
  return {
    tool: 'codex', id: 'abc', label: '/work', stamp: '2026-02-03T04:05:06.000Z', sizeKiB: 4, ...over,
  }
}

type Answer = { ok: true; result: CommandResult } | { ok: false; message: string } | { ok: 'absent' }

/** A Remote answering each call from the queued scripts, in order. */
function bench(answers: readonly Answer[]) {
  const script = [...answers]
  const execute = vi.fn((sessionId: SessionId, line: string, attachments: readonly never[]) => {
    void sessionId
    void line
    void attachments
    const next = script.shift()
    if (next === undefined) throw new Error('unexpected execute call')
    if (next.ok === 'absent') return Promise.resolve({ ok: true as const, value: undefined })
    if (!next.ok) return Promise.resolve({ ok: false as const, error: { message: next.message } })
    return Promise.resolve({ ok: true as const, value: { commandId: CommandId('c1'), result: next.result } })
  })
  const surface = new ImportSurface(SESSION, { execute })
  return { surface, execute, calls: () => execute.mock.calls }
}

/** Drain the surface's unawaited promise chain without fake timers. */
async function flush(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

const LIST_ONE = { ok: true, result: { kind: 'success', text: listing(rowLine('codex', 'abc')) } } as const

describe('ImportSurface listing', () => {
  it('starts closed with the Codex filter selected', () => {
    const { surface } = bench([])
    expect(surface.getSnapshot()).toEqual({
      open: false, busy: false, rows: [], loadFailed: false, filter: 'codex', query: '', page: 0, outcome: null,
    })
  })

  it('opens busy, reads the listing, and notifies subscribers of each change', async () => {
    const { surface, calls } = bench([LIST_ONE])
    const busy: boolean[] = []
    const unsubscribe = surface.subscribe(() => { busy.push(surface.getSnapshot().busy) })

    surface.open()
    // Opening publishes the in-flight state synchronously; the read settles later.
    expect(busy).toEqual([true])
    expect(surface.getSnapshot().open).toBe(true)
    expect(surface.getSnapshot().busy).toBe(true)

    await flush()
    expect(busy).toEqual([true, false])
    expect(surface.getSnapshot().rows).toEqual([row()])
    expect(calls()[0]).toEqual([SESSION, '/import list', []])
    unsubscribe()
    // Unsubscribing stops the notifications, not the state.
    surface.dismiss()
    expect(busy).toEqual([true, false])
  })

  it('treats a second open while the dialog is up as a no-op', async () => {
    const { surface, execute } = bench([LIST_ONE])
    surface.open()
    surface.open()
    await flush()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('dismisses only an open dialog', async () => {
    const { surface } = bench([LIST_ONE])
    surface.dismiss()
    expect(surface.getSnapshot().open).toBe(false)
    surface.open()
    await flush()
    surface.dismiss()
    expect(surface.getSnapshot().open).toBe(false)
  })

  it('reports a failed read distinctly from an empty listing', async () => {
    const { surface } = bench([{ ok: false, message: 'offline' }])
    await surface.refresh()
    expect(surface.getSnapshot()).toMatchObject({ busy: false, loadFailed: true, rows: [] })
  })

  it('reports a read the Host resolved to nothing as a failed read', async () => {
    const { surface } = bench([{ ok: 'absent' }])
    await surface.refresh()
    expect(surface.getSnapshot()).toMatchObject({ busy: false, loadFailed: true, rows: [] })
  })

  it('reports a command error result as a failed read', async () => {
    const { surface } = bench([{ ok: true, result: { kind: 'error', text: 'no roots' } }])
    await surface.refresh()
    expect(surface.getSnapshot()).toMatchObject({ loadFailed: true })
  })

  it('reads an empty listing as loaded with no rows', async () => {
    const { surface } = bench([{
      ok: true,
      result: { kind: 'success', text: [IMPORT_LIST_HEADER, 'none found under the configured roots'].join('\n') },
    }])
    await surface.refresh()
    expect(surface.getSnapshot()).toMatchObject({ loadFailed: false, busy: false, rows: [] })
  })

  it('drops a listing that settles after a newer read started', async () => {
    const { surface } = bench([
      { ok: true, result: { kind: 'success', text: listing(rowLine('codex', 'stale')) } },
      { ok: true, result: { kind: 'success', text: listing(rowLine('codex', 'fresh')) } },
    ])
    const stale = surface.refresh()
    const fresh = surface.refresh()
    await Promise.all([stale, fresh])
    expect(surface.getSnapshot().rows.map(entry => entry.id)).toEqual(['fresh'])
  })

  it('returns to the first page when the filter or the search changes', async () => {
    const { surface } = bench([LIST_ONE])
    await surface.refresh()
    surface.setPage(3)
    expect(surface.getSnapshot().page).toBe(3)

    surface.setFilter('all')
    expect(surface.getSnapshot()).toMatchObject({ filter: 'all', page: 0 })
    surface.setPage(2)
    surface.setQuery('abc')
    expect(surface.getSnapshot()).toMatchObject({ query: 'abc', page: 0 })
  })
})

describe('ImportSurface verbs', () => {
  it('imports a row into a new session and re-reads the listing', async () => {
    const { surface, calls } = bench([
      { ok: true, result: { kind: 'success', text: 'imported 12 events into import-codex-abc' } },
      LIST_ONE,
    ])
    await surface.importNew(row())
    expect(calls()).toEqual([
      [SESSION, '/import codex abc', []],
      [SESSION, '/import list', []],
    ])
    expect(surface.getSnapshot().outcome).toEqual({
      kind: 'ok', text: 'imported 12 events into import-codex-abc', intoNewSession: true,
    })
  })

  it('injects a row into the current session', async () => {
    const { surface, calls } = bench([
      { ok: true, result: { kind: 'success', text: 'injected 4 foreign entries from codex' } },
      { ok: true, result: { kind: 'success', text: listing() } },
    ])
    await surface.inject(row({ tool: 'claude-code', id: 'xyz' }))
    expect(calls()[0]).toEqual([SESSION, '/import --inject claude-code xyz', []])
    expect(surface.getSnapshot().outcome).toEqual({
      kind: 'ok', text: 'injected 4 foreign entries from codex', intoNewSession: false,
    })
  })

  it('reports a missing success text as an empty outcome line', async () => {
    const { surface } = bench([
      { ok: true, result: { kind: 'success' } },
      { ok: true, result: { kind: 'success', text: listing() } },
    ])
    await surface.inject(row())
    expect(surface.getSnapshot().outcome).toEqual({ kind: 'ok', text: '', intoNewSession: false })
  })

  it('surfaces the command error text verbatim', async () => {
    const { surface } = bench([
      { ok: true, result: { kind: 'error', text: 'no codex session "abc" under the configured roots' } },
      { ok: true, result: { kind: 'success', text: listing() } },
    ])
    await surface.importNew(row())
    expect(surface.getSnapshot().outcome).toEqual({
      kind: 'error', text: 'no codex session "abc" under the configured roots',
    })
  })

  it('surfaces a carrier failure as an error outcome and skips the re-read', async () => {
    const { surface, execute } = bench([{ ok: false, message: 'transport closed' }])
    await surface.importNew(row())
    expect(surface.getSnapshot()).toMatchObject({ busy: false, outcome: { kind: 'error', text: 'transport closed' } })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reports a command the Host resolved to nothing as an error', async () => {
    const { surface, execute } = bench([{ ok: 'absent' }, LIST_ONE])
    await surface.importNew(row())
    expect(surface.getSnapshot()).toMatchObject({ busy: false, outcome: { kind: 'error', text: '' } })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('clears a previous outcome when a new command starts', async () => {
    const { surface } = bench([
      { ok: true, result: { kind: 'success', text: 'first' } },
      { ok: true, result: { kind: 'success', text: listing() } },
      { ok: true, result: { kind: 'error', text: 'boom' } },
      { ok: true, result: { kind: 'success', text: listing() } },
    ])
    await surface.importNew(row())
    const pending = surface.importNew(row())
    expect(surface.getSnapshot().outcome).toBeNull()
    await pending
    expect(surface.getSnapshot().outcome).toEqual({ kind: 'error', text: 'boom' })
  })
})

describe('selectPage', () => {
  const state = (over: Partial<ImportDialogState> = {}): ImportDialogState => ({
    open: true, busy: false, rows: [], loadFailed: false, filter: 'codex',
    query: '', page: 0, outcome: null, ...over,
  })

  it('reports one empty page while nothing matched', () => {
    expect(selectPage(state())).toEqual({
      groups: [], page: 1, pages: 1, hasPrevious: false, hasNext: false, matched: 0,
    })
  })

  it('groups the current page and reports the match count before paging', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b' }),
      row({ tool: 'claude-code', id: 'c' }),
    ]
    const selection = selectPage(state({ rows, filter: 'all' }))
    expect(selection.matched).toBe(3)
    expect(selection.groups).toEqual([
      { tool: 'codex', rows: [row({ id: 'a' }), row({ id: 'b' })] },
      { tool: 'claude-code', rows: [row({ tool: 'claude-code', id: 'c' })] },
    ])
  })
})
