/**
 * Per-session state of the import dialog: the listing read, the filter, search,
 * and page inputs, and the one in-flight import command. The Remote call and
 * the subscription live here, outside React; the two entry points share one
 * instance per Session and reach it through their inject faces.
 * @module @deepseek-ai/dsh-client-ui-context-import/client/surface
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandExecution } from '@deepseek-ai/dsh-commands/types'
import {
  filterRows, groupByTool, pageOf, parseImportRows,
  type ImportRow, type ImportTool, type ImportToolFilter,
} from './rows.ts'

/** A carrier failure's message, as a Remote call reports it. */
interface RemoteFailure {
  readonly message: string
}

/** Outcome the dialog shows for the last import or injection. */
export type ImportOutcome =
  | { readonly kind: 'ok'; readonly text: string; readonly intoNewSession: boolean }
  | { readonly kind: 'error'; readonly text: string }

/** Everything the dialog renders from. */
export interface ImportDialogState {
  readonly open: boolean
  /** A `/import list` read or an import command is in flight; the actions are disabled. */
  readonly busy: boolean
  /** Rows of the last successful listing; empty before the first read. */
  readonly rows: readonly ImportRow[]
  /** The last listing read failed; the dialog shows a distinct load-failure state. */
  readonly loadFailed: boolean
  readonly filter: ImportToolFilter
  readonly query: string
  /** 0-based page position, clamped against the current matches. */
  readonly page: number
  readonly outcome: ImportOutcome | null
}

/** The `/import` listing through the already-available commands Remote. */
export interface ImportRemote {
  /**
   * Execute one `/import` line against the Session's agent.
   * @param sessionId - Session addressed by the command.
   * @param line - the command line, slash included.
   * @param attachments - command attachments; this dialog submits none.
   * @returns the carrier result; the business outcome rides `value.result`, and
   * `value` itself is absent when the Host resolved no such command.
   */
  execute: (
    sessionId: SessionId,
    line: string,
    attachments: readonly never[],
  ) => Promise<ImportRemoteResult>
}

/** The carrier result of one command execution: present, absent, or failed. */
type ImportRemoteResult =
  | { readonly ok: true; readonly value: CommandExecution | undefined }
  | { readonly ok: false; readonly error: RemoteFailure }

/** The state a closed, not-yet-read dialog holds. */
const INITIAL: ImportDialogState = {
  open: false, busy: false, rows: [], loadFailed: false, filter: 'codex', query: '', page: 0, outcome: null,
}

/**
 * One Session's import dialog. `open()` starts the listing read, so a second
 * click while the dialog is up is the no-op it looks like.
 */
export class ImportSurface {
  private readonly listeners = new Set<() => void>()
  private value: ImportDialogState = INITIAL
  /** Read generation: bumped by every listing read so a stale settlement is dropped. */
  private generation = 0

  /**
   * @param sessionId - the Session this dialog lists and imports for.
   * @param remote - the commands Remote to execute `/import` through.
   */
  constructor(
    private readonly sessionId: SessionId,
    private readonly remote: ImportRemote,
  ) {}

  /**
   * Subscribe to dialog state.
   * @param listener - invalidation callback.
   * @returns unsubscribe.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the current state; the reference is stable between changes.
   * @returns the dialog state.
   */
  getSnapshot = (): ImportDialogState => this.value

  /** Open the dialog and read the listing. */
  open(): void {
    if (this.value.open) return
    // One publish for the whole transition: a dialog that is open but not yet
    // reading would paint its empty state for a frame.
    this.publish({ ...this.value, open: true, busy: true, loadFailed: false, outcome: null })
    void this.read(++this.generation)
  }

  /** Close the dialog; a finished listing stays for the next open. */
  dismiss(): void {
    if (!this.value.open) return
    this.publish({ ...this.value, open: false })
  }

  /** Re-read the listing, keeping the filter, search, and page inputs. */
  async refresh(): Promise<void> {
    const generation = ++this.generation
    this.publish({ ...this.value, busy: true, loadFailed: false, outcome: null })
    await this.read(generation)
  }

  /**
   * Run one listing read and publish its settlement. The caller publishes the
   * in-flight state first, so the dialog never paints a stale result as current.
   * @param generation - the read's generation; a superseded read publishes nothing.
   * @returns after the read settles.
   */
  private async read(generation: number): Promise<void> {
    const result = await this.remote.execute(this.sessionId, '/import list', [])
    if (generation !== this.generation) return
    const text = result.ok && result.value !== undefined && result.value.result.kind === 'success'
      ? result.value.result.text
      : undefined
    if (text === undefined) {
      this.publish({ ...this.value, busy: false, loadFailed: true })
      return
    }
    this.publish({ ...this.value, busy: false, loadFailed: false, rows: parseImportRows(text), page: 0 })
  }

  /**
   * Choose the tool filter; the page returns to the first, since the match set changes.
   * @param filter - selected tool, or `all`.
   */
  setFilter(filter: ImportToolFilter): void {
    this.publish({ ...this.value, filter, page: 0 })
  }

  /**
   * Replace the search text; the page returns to the first.
   * @param query - raw search text.
   */
  setQuery(query: string): void {
    this.publish({ ...this.value, query, page: 0 })
  }

  /**
   * Move one page within the current matches.
   * @param page - 0-based page position.
   */
  setPage(page: number): void {
    this.publish({ ...this.value, page })
  }

  /**
   * Import one row into a new Session, then re-read the listing.
   * @param row - the row to import.
   * @returns after the command and the follow-up read settle.
   */
  async importNew(row: ImportRow): Promise<void> {
    await this.run(`/import ${row.tool} ${row.id}`, true)
  }

  /**
   * Inject one row into the Session the dialog was opened from, then re-read
   * the listing.
   * @param row - the row to inject.
   * @returns after the command and the follow-up read settle.
   */
  async inject(row: ImportRow): Promise<void> {
    await this.run(`/import --inject ${row.tool} ${row.id}`, false)
  }

  /**
   * Execute one import command and publish its outcome, then re-read the
   * listing: an import may have changed what is still importable.
   * @param line - the command line.
   * @param intoNewSession - whether this line creates a Session.
   * @returns after the command and the follow-up read settle.
   */
  private async run(line: string, intoNewSession: boolean): Promise<void> {
    this.publish({ ...this.value, busy: true, outcome: null })
    const result = await this.remote.execute(this.sessionId, line, [])
    if (!result.ok) {
      this.publish({ ...this.value, busy: false, outcome: { kind: 'error', text: result.error.message } })
      return
    }
    const settled = result.value?.result
    const outcome: ImportOutcome = settled === undefined
      ? { kind: 'error', text: '' }
      : settled.kind === 'success'
        ? { kind: 'ok', text: settled.text ?? '', intoNewSession }
        : { kind: 'error', text: settled.text }
    // Re-read before publishing the outcome: the read clears it, and the
    // command's own report is what the user is waiting to see.
    await this.refresh()
    this.publish({ ...this.value, outcome })
  }

  /** Publish one state and notify subscribers. */
  private publish(next: ImportDialogState): void {
    this.value = next
    for (const listener of [...this.listeners]) listener()
  }
}

/** One page of grouped matches, as the dialog's table renders them. */
export interface ImportSelection {
  readonly groups: { tool: ImportTool; rows: ImportRow[] }[]
  /** 1-based position of this page; 1 while nothing matched. */
  readonly page: number
  /** Total pages; 1 while nothing matched. */
  readonly pages: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  /** Matches after the filter and search, before paging. */
  readonly matched: number
}

/**
 * Project the dialog's inputs into the rows one page shows.
 * @param state - the dialog state.
 * @returns grouped page rows plus the page position.
 */
export function selectPage(state: ImportDialogState): ImportSelection {
  const matched = filterRows(state.rows, state.filter, state.query)
  const page = pageOf(matched, state.page)
  return {
    groups: groupByTool(page.rows),
    page: page.page,
    pages: page.pages,
    hasPrevious: page.hasPrevious,
    hasNext: page.hasNext,
    matched: matched.length,
  }
}
