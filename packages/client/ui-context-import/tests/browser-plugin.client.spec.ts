/**
 * ui-context-import browser and node halves: the header action and dialog
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the locale registrations, the `command/executed`
 * trigger that opens the dialog for a bare `/import`, and the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandResult } from '@deepseek-ai/dsh-commands/types'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import type { ImportDialogInjected, ImportHeaderInjected } from '../src/client/slots.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId
const OTHER = 'other' as SessionId
const HEADER = 'conversation.session.header.actions'
const OVERLAY = 'conversation.input.overlay'
const LISTING = 'import list · 可导入会话：\ncodex abc  (/work, 2026-02-03T04:05:06.000Z, 4 KiB)'

/** Slot ledger reader: entry ids currently registered under one slot. */
function entryIds(ctx: Context, slot: keyof SlotMap & string): (string | undefined)[] {
  return ctx.slots.entries(slot).map(entry => entry.options.id)
}

/** The recorded command lines, with the Session each addressed. */
interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  calls: [sessionId: SessionId, line: string, attachments: readonly never[]][]
  headerFace: (sessionId: SessionId) => ImportHeaderInjected
  dialogFace: (sessionId: SessionId) => ImportDialogInjected
}

/** Boot the browser half over a real slot tree that declares both slots. */
async function bench(script: CommandResult[] = [{ kind: 'success', text: LISTING }]): Promise<Bench> {
  const ctx = new Context()
  const calls: Bench['calls'] = []
  const remaining = [...script]
  const commands = {
    execute: (sessionId: SessionId, line: string, attachments: readonly never[]) => {
      calls.push([sessionId, line, attachments])
      const result = remaining.shift() ?? { kind: 'success' as const, text: LISTING }
      return Promise.resolve({ ok: true as const, value: { commandId: 'c1', result } })
    },
  }
  // Cordis resolves a nested service name from its own provide entry, so the
  // `remote` face and the `remote.commands` namespace are both registered.
  ctx.provide('remote', { commands } as never)
  ctx.provide('remote.commands', commands as never)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      [HEADER]: { kind: 'list', scope: 'session' },
      [OVERLAY]: { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  /** The recorded registration's inject factory, typed as the entry sees it. */
  const faceAt = (slot: keyof SlotMap & string): unknown => {
    const entry = ctx.slots.entries(slot)[0]
    if (entry?.inject === undefined) throw new Error(`no inject face registered under ${slot}`)
    return entry.inject
  }
  return {
    ctx,
    fiber,
    calls,
    headerFace: faceAt(HEADER) as (sessionId: SessionId) => ImportHeaderInjected,
    dialogFace: faceAt(OVERLAY) as (sessionId: SessionId) => ImportDialogInjected,
  }
}

/** Let an unawaited command chain settle. */
async function flush(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

describe('ui-context-import browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('registers both entries with their ids, orders, and locale', async () => {
    const b = await bench()
    expect(entryIds(b.ctx, HEADER)).toEqual(['context-import'])
    expect(entryIds(b.ctx, OVERLAY)).toEqual(['context-import-dialog'])
    expect(b.ctx.slots.entries(HEADER)[0]?.options.order).toBe(30)
    expect(b.ctx.slots.entries(OVERLAY)[0]?.options.order).toBe(3)
    expect(b.ctx.slots.entries(HEADER)[0]?.locale).toBe(NS)
    expect(b.ctx.slots.entries(OVERLAY)[0]?.locale).toBe(NS)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const b = await bench()
    // These specs assert the shipped Chinese copy, the source of truth for this GUI.
    b.ctx.locale.setLocale('zh')
    const translate = b.ctx.locale.bind(NS)
    expect(translate('action.label')).toBe(zh['action.label'])
    b.ctx.locale.setLocale('en')
    expect(translate('action.label')).toBe(en['action.label'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await b.fiber.dispose()
    expect(translate('action.label')).not.toBe(en['action.label'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('opens the dialog from the header action and reads the listing', async () => {
    const b = await bench()
    const header = b.headerFace(SESSION)
    const dialog = b.dialogFace(SESSION)
    expect(dialog.hooks.importDialog.getSnapshot().open).toBe(false)

    header.openDialog()
    expect(dialog.hooks.importDialog.getSnapshot().busy).toBe(true)
    expect(b.calls).toEqual([[SESSION, '/import list', []]])

    await flush()
    expect(dialog.hooks.importDialog.getSnapshot()).toMatchObject({
      open: true, busy: false, loadFailed: false,
    })
    expect(dialog.hooks.importDialog.getSnapshot().rows.map(row => row.id)).toEqual(['abc'])
    dialog.dismiss()
    expect(dialog.hooks.importDialog.getSnapshot().open).toBe(false)
  })

  it('gives each Session its own dialog state', async () => {
    const b = await bench()
    b.headerFace(SESSION).openDialog()
    await flush()

    expect(b.ctx.slots.entries(OVERLAY)).toHaveLength(1)
    const other = b.dialogFace(OTHER)
    expect(other.hooks.importDialog.getSnapshot()).toMatchObject({ open: false, rows: [] })
    other.setFilter('all')
    expect(other.hooks.importDialog.getSnapshot().filter).toBe('all')
    expect(b.dialogFace(SESSION).hooks.importDialog.getSnapshot().filter).toBe('codex')
  })

  it('exposes the dialog verbs through the surface', async () => {
    const b = await bench([
      { kind: 'success', text: LISTING },
      { kind: 'success', text: 'imported 4 events into import-codex-abc' },
      { kind: 'success', text: LISTING },
      { kind: 'success', text: 'injected 4 foreign entries from codex' },
      { kind: 'success', text: LISTING },
    ])
    const face = b.dialogFace(SESSION)
    await face.refresh()
    const row = face.hooks.importDialog.getSnapshot().rows[0]!

    face.setQuery('abc')
    face.setFilter('all')
    face.setPage(2)
    expect(face.hooks.importDialog.getSnapshot()).toMatchObject({ query: 'abc', filter: 'all' })

    await face.importNew(row)
    await face.inject(row)
    expect(b.calls.map(call => call[1])).toEqual([
      '/import list', '/import codex abc', '/import list', '/import --inject codex abc', '/import list',
    ])
  })

  it('opens the dialog when a bare /import reports its usage line', async () => {
    const b = await bench([{ kind: 'success', text: 'usage: /import list | /import <codex|claude-code> <session-id>' }])
    b.ctx.emit('command/executed', SESSION, 'import', {
      kind: 'success', text: 'usage: /import list | /import <codex|claude-code> <session-id>',
    })
    expect(b.dialogFace(SESSION).hooks.importDialog.getSnapshot().busy).toBe(true)

    await flush()
    expect(b.dialogFace(SESSION).hooks.importDialog.getSnapshot().open).toBe(true)
    expect(b.calls).toEqual([[SESSION, '/import list', []]])
  })

  it('does not open the dialog for a listing, an import, another command, or a failed import', async () => {
    const b = await bench()
    const opens = (): boolean => b.dialogFace(SESSION).hooks.importDialog.getSnapshot().open

    b.ctx.emit('command/executed', SESSION, 'import', { kind: 'success', text: LISTING })
    expect(opens()).toBe(false)

    b.ctx.emit('command/executed', SESSION, 'import', { kind: 'success', text: 'imported 4 events into import-codex-abc' })
    expect(opens()).toBe(false)

    b.ctx.emit('command/executed', SESSION, 'goal', { kind: 'success', text: 'usage: /goal' })
    expect(opens()).toBe(false)

    b.ctx.emit('command/executed', SESSION, 'import', { kind: 'error', text: 'usage: /import' })
    expect(opens()).toBe(false)
    expect(b.calls).toEqual([])
  })

  it('opens the dialog on the Session the command was typed in', async () => {
    const b = await bench()
    b.ctx.emit('command/executed', OTHER, 'import', { kind: 'success', text: 'usage: /import' })
    await flush()
    expect(b.dialogFace(OTHER).hooks.importDialog.getSnapshot().open).toBe(true)
    expect(b.dialogFace(SESSION).hooks.importDialog.getSnapshot().open).toBe(false)
  })

  it('withdraws the registrations with the plugin fiber (HMR safety)', async () => {
    const b = await bench()
    const dialog = b.dialogFace(SESSION)
    const opened = dialog.hooks.importDialog.getSnapshot()
    expect(entryIds(b.ctx, HEADER)).toContain('context-import')
    expect(entryIds(b.ctx, OVERLAY)).toContain('context-import-dialog')

    await b.fiber.dispose()
    expect(b.ctx.slots.entries(HEADER)).toHaveLength(0)
    expect(b.ctx.slots.entries(OVERLAY)).toHaveLength(0)
    // The face handed out before teardown keeps reading the same surface object.
    expect(dialog.hooks.importDialog.getSnapshot()).toBe(opened)
  })

  it('re-registers cleanly when the plugin is reloaded', async () => {
    const b = await bench()
    await b.fiber.dispose()
    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()
    expect(entryIds(b.ctx, HEADER)).toEqual(['context-import'])
    expect(entryIds(b.ctx, OVERLAY)).toEqual(['context-import-dialog'])
  })
})

describe('ui-context-import node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(() => { applyNode() }).not.toThrow()
  })
})
