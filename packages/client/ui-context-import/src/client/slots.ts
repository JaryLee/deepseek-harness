/**
 * Inject faces of this package's two entries. Both reach the same per-Session
 * import surface: the header entry opens it, the overlay entry renders it. Live
 * state arrives through the `hooks` compartment, which the framework binds to
 * the `useImportDialog` selector hook.
 * @module @deepseek-ai/dsh-client-ui-context-import/client/slots
 */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImportDialogState } from './surface.ts'
import type { ImportRow, ImportToolFilter } from './rows.ts'
import type { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Injected face of the session-header import action. */
export interface ImportHeaderInjected {
  /** Open this Session's import dialog. */
  openDialog: () => void
}

/** Injected face of the import dialog. */
export interface ImportDialogInjected {
  hooks: {
    /** This Session's dialog state. */
    importDialog: HostObservable<ImportDialogState>
  }
  /** Close the dialog. */
  dismiss: () => void
  /** Re-read the importable listing. */
  refresh: () => Promise<void>
  /** Replace the search text. */
  setQuery: (query: string) => void
  /** Choose the tool filter. */
  setFilter: (filter: ImportToolFilter) => void
  /** Move one page within the current matches. */
  setPage: (page: number) => void
  /** Import a row into a new Session. */
  importNew: (row: ImportRow) => Promise<void>
  /** Inject a row into this Session. */
  inject: (row: ImportRow) => Promise<void>
}

/** Full props of the session-header import action. */
export type ImportHeaderActionProps = PropsRuntime<'conversation.session.header.actions'>
  & ImportHeaderInjected
  & PropsLocale<typeof NS>

/** Full props of the import dialog overlay entry. */
export type ImportDialogProps = InjectFace<ImportDialogInjected> & PropsLocale<typeof NS>
