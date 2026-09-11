/**
 * Context-import plugin, browser half: the 导入会话 header action and the
 * import dialog it opens. Both entries share one {@link ImportSurface} per
 * Session, which reads the foreign listing and runs imports through
 * `ctx.remote.commands.execute`; a bare `/import` typed in the composer opens
 * the same dialog from the `command/executed` event.
 * @module @deepseek-ai/dsh-client-ui-context-import/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the command UI's `command/executed` event declaration.
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the header action and overlay entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useSession seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { ImportDialog } from './ImportDialog.tsx'
import { ImportHeaderAction } from './ImportHeaderAction.tsx'
import { isImportUsage } from './rows.ts'
import type { ImportDialogInjected, ImportHeaderInjected } from './slots.ts'
import { ImportSurface } from './surface.ts'
import { en, NS, zh, type ContextImportKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The import action and dialog copy. */
    'contextImport': ContextImportKey
  }
}

export type { ImportDialogState, ImportOutcome } from './surface.ts'
export type {
  ImportDialogInjected, ImportDialogProps, ImportHeaderActionProps, ImportHeaderInjected,
} from './slots.ts'
export type { ImportRow, ImportTool, ImportToolFilter } from './rows.ts'
export type { ContextImportKey } from './locales.ts'

/** Required services: the slot registry, the commands Remote, the locale registry, and the event bus. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: the header action, the dialog entry, and the
 * `command/executed` trigger that opens the dialog for a bare `/import`.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-context-import: dictionaries')

  const surfaces = new Map<SessionId, ImportSurface>()
  const surfaceFor = (sessionId: SessionId): ImportSurface => {
    let surface = surfaces.get(sessionId)
    if (surface === undefined) {
      surface = new ImportSurface(sessionId, ctx.remote.commands)
      surfaces.set(sessionId, surface)
    }
    return surface
  }
  ctx.effect(() => () => { surfaces.clear() }, 'ui-context-import: per-session surfaces')

  // Only the usage line opens the dialog: `/import list` and a real import
  // already report their own outcome in the composer.
  ctx.on('command/executed', (sessionId, name, result) => {
    if (name !== 'import' || result.kind !== 'success' || !isImportUsage(result.text)) return
    surfaceFor(sessionId).open()
  })

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'context-import',
    // After the job list and the export utilities: an import is the rarest act here.
    order: 30,
    locale: NS,
    inject: (sessionId): ImportHeaderInjected => ({
      openDialog: () => { surfaceFor(sessionId).open() },
    }),
  }, ImportHeaderAction))

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: 'context-import-dialog',
    order: 3,
    locale: NS,
    inject: (sessionId): ImportDialogInjected => {
      const surface = surfaceFor(sessionId)
      return {
        hooks: { importDialog: surface },
        dismiss: () => { surface.dismiss() },
        refresh: () => surface.refresh(),
        setQuery: (query) => { surface.setQuery(query) },
        setFilter: (filter) => { surface.setFilter(filter) },
        setPage: (page) => { surface.setPage(page) },
        importNew: row => surface.importNew(row),
        inject: row => surface.inject(row),
      }
    },
  }, ImportDialog))
}
