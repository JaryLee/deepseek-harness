// @vitest-environment jsdom
/**
 * The import dialog as the user sees it: the localized empty, loading, and
 * load-failure states, the Codex-defaulted tool filter, the search box, the
 * grouped and paged result table, and the outcome line both import verbs
 * produce.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import { ImportDialog } from '../src/client/ImportDialog.tsx'
import type { ImportDialogProps } from '../src/client/slots.ts'
import { ImportSurface, type ImportRemote } from '../src/client/surface.ts'
import { IMPORT_LIST_HEADER, PAGE_SIZE } from '../src/client/rows.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const SESSION = 'session' as SessionId
const translate = makeTranslate(zh)

/** One listing row, as the Host renders it. */
function rowLine(tool: string, id: string, title?: string): string {
  const named = title === undefined ? '' : `, ${JSON.stringify(title)}`
  return `${tool} ${id}  (/work/${id}, 2026-02-03T04:05:06.000Z, 4 KiB${named})`
}

/** A `/import list` result text: header plus the given rows. */
function listing(...lines: string[]): string {
  return [IMPORT_LIST_HEADER, ...lines].join('\n')
}

/** A Remote answering each call from the queued results, in order. */
function bench(results: readonly CommandResult[]) {
  const script = [...results]
  const execute = vi.fn((sessionId: SessionId, line: string, attachments: readonly never[]) => {
    void sessionId
    void line
    void attachments
    const next = script.shift()
    if (next === undefined) throw new Error('unexpected execute call')
    return Promise.resolve({ ok: true as const, value: { commandId: 'c1', result: next } })
  })
  const surface = new ImportSurface(SESSION, { execute } as unknown as ImportRemote)
  return { surface, execute }
}

/**
 * Props for the dialog over one surface. The selector hook is a real
 * `useSyncExternalStore` binding over the surface's own snapshot/subscribe
 * pair, so a surface change drives a React update exactly as the renderer does.
 */
function props(surface: ImportSurface): ImportDialogProps {
  return {
    useImportDialog: selector => useSyncExternalStore(surface.subscribe, () => selector(surface.getSnapshot())),
    dismiss: () => { surface.dismiss() },
    refresh: () => surface.refresh(),
    setQuery: (query) => { surface.setQuery(query) },
    setFilter: (filter) => { surface.setFilter(filter) },
    setPage: (page) => { surface.setPage(page) },
    importNew: row => surface.importNew(row),
    inject: row => surface.inject(row),
    t: translate,
  }
}

/** Run a surface mutation inside React's act scope and drain its promise chain. */
async function run(action: () => void, times = 8): Promise<void> {
  await act(async () => {
    action()
    for (let index = 0; index < times; index += 1) await Promise.resolve()
  })
}

/** The cells of one result row, in column order. */
function cells(name: string): string[] {
  const row = screen.getByRole('cell', { name })?.closest('tr')
  if (row === null) throw new Error(`no row for "${name}"`)
  return [...row.querySelectorAll('td')].map(cell => cell.textContent ?? '')
}

describe('ImportDialog states', () => {
  it('renders nothing while the dialog is closed', () => {
    const { surface } = bench([])
    const { container } = render(<ImportDialog {...props(surface)} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the reading state while the first listing is in flight, then the rows', async () => {
    const { surface } = bench([{ kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) }])
    render(<ImportDialog {...props(surface)} />)
    act(() => { surface.open() })
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeDefined()
    expect(screen.getByText(zh['state.loading'])).toBeDefined()
    expect(screen.getByText(zh['status.busy'])).toBeDefined()

    await run(() => {})
    expect(screen.queryByText(zh['state.loading'])).toBeNull()
    expect(screen.getByText('Codex work')).toBeDefined()
  })

  it('shows the empty state for a listing with no sessions', async () => {
    const { surface } = bench([{
      kind: 'success', text: [IMPORT_LIST_HEADER, 'none found under the configured roots'].join('\n'),
    }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    expect(screen.getByText(zh['state.empty'])).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(zh['state.loadFailed'])).toBeNull()
  })

  it('shows the load-failure state for a failed read', async () => {
    const { surface } = bench([{ kind: 'error', text: 'no roots' }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    expect(screen.getByText(zh['state.loadFailed'])).toBeDefined()
    expect(screen.queryByText(zh['state.empty'])).toBeNull()
  })

  it('shows the no-match state when the filter or the search excludes every row', async () => {
    const { surface } = bench([{ kind: 'success', text: listing(rowLine('codex', 'abc')) }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    fireEvent.change(screen.getByRole('searchbox', { name: zh['search.label'] }), { target: { value: 'nothing' } })
    expect(screen.getByText(zh['state.noMatch'])).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('ImportDialog listing', () => {
  it('lists Codex rows by default and switches to every tool on demand', async () => {
    const { surface } = bench([{
      kind: 'success',
      text: listing(rowLine('codex', 'c1', 'Codex work'), rowLine('claude-code', 'l1', 'Claude work')),
    }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    const [name, directory, stamp, size, actions] = cells('Codex work')
    expect([name, directory, size]).toEqual(['Codex work', '/work/c1', '4 KiB'])
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
    expect(actions).toBe(`${zh['row.import']}${zh['row.inject']}`)
    expect(screen.queryByText('Claude work')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['filter.all'] }))
    expect(screen.getByText('Claude work')).toBeDefined()
    expect(screen.getByText(translate('group.title', { tool: zh['filter.claude-code'], count: 1 }))).toBeDefined()
    expect(screen.getByText(translate('group.title', { tool: zh['filter.codex'], count: 1 }))).toBeDefined()
  })

  it('falls back to the session id when the listing records no title', async () => {
    const { surface } = bench([{ kind: 'success', text: listing(rowLine('codex', 'c1')) }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    expect(screen.getByRole('cell', { name: 'c1' })).toBeDefined()
  })

  it('searches by title, case-insensitively', async () => {
    const { surface } = bench([{
      kind: 'success',
      text: listing(rowLine('codex', 'c1', 'Fix The Build'), rowLine('codex', 'c2', 'Other')),
    }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    fireEvent.change(screen.getByRole('searchbox', { name: zh['search.label'] }), { target: { value: 'the build' } })
    expect(screen.getByText('Fix The Build')).toBeDefined()
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('pages the matches and reports the position', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 2 }, (_unused, index) => rowLine('codex', `id-${index}`))
    const { surface } = bench([{ kind: 'success', text: listing(...rows) }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    expect(screen.getByText(translate('page.position', { page: 1, pages: 2 }))).toBeDefined()
    const table = screen.getByRole('table', { name: zh['dialog.table'] })
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 1 + PAGE_SIZE)
    expect(screen.getByRole('button', { name: zh['page.previous'] }).hasAttribute('disabled')).toBe(true)
    // The previous control on the first page is disabled; its handler still
    // clamps rather than underflowing.
    fireEvent.click(screen.getByRole('button', { name: zh['page.previous'] }))
    expect(screen.getByText(translate('page.position', { page: 1, pages: 2 }))).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: zh['page.next'] }))
    expect(screen.getByText(translate('page.position', { page: 2, pages: 2 }))).toBeDefined()
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 1 + 2)
    expect(screen.getByRole('button', { name: zh['page.next'] }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: zh['page.previous'] }))
    expect(screen.getByText(translate('page.position', { page: 1, pages: 2 }))).toBeDefined()
  })
})

describe('ImportDialog commands', () => {
  it('imports a row into a new session and reports the new sidebar session', async () => {
    const { surface, execute } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'success', text: 'imported 12 events into import-codex-c1' },
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    fireEvent.click(screen.getByRole('button', { name: translate('row.importAria', { name: 'Codex work' }) }))
    await run(() => {})

    expect(execute.mock.calls.map(call => call[1])).toEqual([
      '/import list', '/import codex c1', '/import list',
    ])
    expect(screen.getByText(
      translate('status.okNew', { text: 'imported 12 events into import-codex-c1' }),
    )).toBeDefined()
  })

  it('injects a row into the current session with its own command line', async () => {
    const { surface, execute } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'success', text: 'injected 4 foreign entries from codex' },
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    fireEvent.click(screen.getByRole('button', { name: translate('row.injectAria', { name: 'Codex work' }) }))
    await run(() => {})

    expect(execute.mock.calls.map(call => call[1])).toEqual([
      '/import list', '/import --inject codex c1', '/import list',
    ])
    expect(screen.getByText(translate('status.okInject', { text: 'injected 4 foreign entries from codex' }))).toBeDefined()
  })

  it('shows a failed import\'s own error text', async () => {
    const failure = 'no codex session "c1" under the configured roots'
    const { surface } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'error', text: failure },
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    fireEvent.click(screen.getByRole('button', { name: translate('row.importAria', { name: 'Codex work' }) }))
    await run(() => {})
    expect(screen.getByText(translate('status.error', { text: failure }))).toBeDefined()
  })

  it('disables every action while a command is in flight', async () => {
    const { surface } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'success', text: 'imported 1 events into import-codex-c1' },
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    const rowImport = screen.getByRole('button', { name: translate('row.importAria', { name: 'Codex work' }) })
    fireEvent.click(rowImport)
    // The click published the busy state synchronously; nothing settles yet.
    expect(rowImport.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['filter.all'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('searchbox', { name: zh['search.label'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['dialog.refresh'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(zh['status.busy'])).toBeDefined()

    await run(() => {})
    expect(rowImport.hasAttribute('disabled')).toBe(false)
  })

  it('re-reads the listing on demand', async () => {
    const { surface, execute } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'success', text: listing(rowLine('codex', 'c2', 'Later')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    fireEvent.click(screen.getByRole('button', { name: zh['dialog.refresh'] }))
    await run(() => {})
    expect(execute).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Later')).toBeDefined()
  })
})

describe('ImportDialog dismissal', () => {
  it('closes on the close button and on Escape', async () => {
    const { surface } = bench([
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
      { kind: 'success', text: listing(rowLine('codex', 'c1', 'Codex work')) },
    ])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })

    fireEvent.click(screen.getByRole('button', { name: zh['dialog.close'] }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await run(() => { surface.open() })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on a mask click', async () => {
    const { surface } = bench([{ kind: 'success', text: listing() }])
    render(<ImportDialog {...props(surface)} />)
    await run(() => { surface.open() })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement?.firstElementChild as Element)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
