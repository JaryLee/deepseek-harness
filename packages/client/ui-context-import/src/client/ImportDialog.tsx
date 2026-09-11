/**
 * The import dialog: one `conversation.input.overlay` entry per Session,
 * rendering the listing the header action opened. Every read and command runs
 * through the Session's surface; this component only renders state and forwards
 * the user's inputs.
 * @module @deepseek-ai/dsh-client-ui-context-import/client/ImportDialog
 */

import {
  Button, Input, Modal, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { formatStamp, rowName, type ImportToolFilter } from './rows.ts'
import { selectPage, type ImportDialogState } from './surface.ts'
import type { ImportDialogProps } from './slots.ts'
import css from './ImportDialog.module.css'

/** Tool filter values, in display order; `all` lifts the filter. */
const FILTERS: readonly ImportToolFilter[] = ['all', 'codex', 'claude-code']

/** Locale key of one filter value. */
const FILTER_KEY = {
  'all': 'filter.all',
  'codex': 'filter.codex',
  'claude-code': 'filter.claude-code',
} as const satisfies Record<ImportToolFilter, string>

/** How many columns the table's group rows span. */
const COLUMNS = 5

/**
 * The outcome line under the table, or the in-flight notice.
 * @param state - the dialog state.
 * @param t - the namespace translator.
 * @returns the line to render, or an empty string while there is nothing to report.
 */
function statusLine(state: ImportDialogState, t: ImportDialogProps['t']): string {
  if (state.busy) return t('status.busy')
  if (state.outcome === null) return ''
  if (state.outcome.kind === 'error') return t('status.error', { text: state.outcome.text })
  return t(state.outcome.intoNewSession ? 'status.okNew' : 'status.okInject', { text: state.outcome.text })
}

/**
 * Render one Session's import dialog.
 * @param props - the dialog state hook, the surface's verbs, and the translator.
 * @returns the modal, portal-mounted by the primitive.
 */
export function ImportDialog({
  useImportDialog, dismiss, refresh, setQuery, setFilter, setPage, importNew, inject, t,
}: ImportDialogProps) {
  const state = useImportDialog(value => value)
  const selection = selectPage(state)
  const { page, pages, matched, groups } = selection

  return (
    <Modal
      open={state.open}
      title={t('dialog.title')}
      closeLabel={t('dialog.close')}
      onClose={dismiss}
      className={css.dialog as string}
      contentClassName={css.content as string}
      footer={(
        <div className={css.footer}>
          <span className={css.status}>{statusLine(state, t)}</span>
          <div className={css.pager} role="group" aria-label={t('page.position', { page, pages })}>
            <Button
              size="sm"
              disabled={!selection.hasPrevious || state.busy}
              onClick={() => { setPage(page - 2) }}
            >
              {t('page.previous')}
            </Button>
            <span className={css.position}>{t('page.position', { page, pages })}</span>
            <Button
              size="sm"
              disabled={!selection.hasNext || state.busy}
              onClick={() => { setPage(page) }}
            >
              {t('page.next')}
            </Button>
          </div>
        </div>
      )}
    >
      <div className={css.toolbar}>
        <div className={css.filters} role="group" aria-label={t('filter.label')}>
          {FILTERS.map(filter => (
            <Pill
              key={filter}
              active={state.filter === filter}
              disabled={state.busy}
              onClick={() => { setFilter(filter) }}
            >
              {t(FILTER_KEY[filter])}
            </Pill>
          ))}
        </div>
        <Input
          className={css.search as string}
          type="search"
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={state.query}
          disabled={state.busy}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <Button size="sm" disabled={state.busy} onClick={() => { void refresh() }}>
          {t('dialog.refresh')}
        </Button>
      </div>
      <DialogBody state={state} matched={matched} t={t} />
      {matched > 0
        ? (
          <table className={css.table} aria-label={t('dialog.table')}>
            <thead>
              <tr>
                <th scope="col">{t('column.name')}</th>
                <th scope="col">{t('column.directory')}</th>
                <th scope="col">{t('column.time')}</th>
                <th scope="col">{t('column.size')}</th>
                <th scope="col">{t('column.actions')}</th>
              </tr>
            </thead>
            {groups.map(group => (
              <tbody key={group.tool}>
                <tr>
                  <th scope="colgroup" colSpan={COLUMNS} className={css.group}>
                    {t('group.title', { tool: t(FILTER_KEY[group.tool]), count: group.rows.length })}
                  </th>
                </tr>
                {group.rows.map((row) => {
                  const name = rowName(row)
                  return (
                    <tr key={`${row.tool}\u0000${row.id}`}>
                      <td className={css.name} title={name}>{name}</td>
                      <td className={css.directory} title={row.label}>{row.label}</td>
                      <td className={css.stamp}>{formatStamp(row.stamp)}</td>
                      <td className={css.size}>{t('size.unit', { size: row.sizeKiB })}</td>
                      <td className={css.actions}>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={state.busy}
                          aria-label={t('row.importAria', { name })}
                          onClick={() => { void importNew(row) }}
                        >
                          {t('row.import')}
                        </Button>
                        <Button
                          size="sm"
                          disabled={state.busy}
                          aria-label={t('row.injectAria', { name })}
                          onClick={() => { void inject(row) }}
                        >
                          {t('row.inject')}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
        )
        : null}
    </Modal>
  )
}

/**
 * The single table-replacing state line: reading, read failure, nothing
 * importable, or nothing matching the current inputs.
 * @param props.state - the dialog state.
 * @param props.matched - matches after the filter and search.
 * @param props.t - the namespace translator.
 * @returns the line, or null while the table has rows to show.
 */
function DialogBody({ state, matched, t }: {
  state: ImportDialogState
  matched: number
  t: ImportDialogProps['t']
}) {
  if (state.busy && state.rows.length === 0) return <p className={css.state}>{t('state.loading')}</p>
  if (!state.busy && state.loadFailed) return <p className={css.state}>{t('state.loadFailed')}</p>
  if (!state.busy && !state.loadFailed && state.rows.length === 0) {
    return <p className={css.state}>{t('state.empty')}</p>
  }
  if (!state.busy && !state.loadFailed && matched === 0) {
    return <p className={css.state}>{t('state.noMatch')}</p>
  }
  return null
}
