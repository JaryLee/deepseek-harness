/**
 * Session-header entry point for the import dialog. The dialog itself is the
 * `conversation.input.overlay` contribution; this button only asks the
 * Session's surface to open it.
 * @module @deepseek-ai/dsh-client-ui-context-import/client/ImportHeaderAction
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImportHeaderInjected } from './slots.ts'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ImportHeaderAction.module.css'

/** Full props for the session-header import action. */
export type ImportHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'> & ImportHeaderInjected & PropsLocale<typeof NS>

/**
 * Render the header control that opens this Session's import dialog.
 * @param props - the slot's runtime currency, the surface's open verb, and the translator.
 * @returns the trigger button.
 */
export function ImportHeaderAction({ openDialog, t }: ImportHeaderActionProps) {
  return (
    <button type="button" className={css.trigger} onClick={() => { openDialog() }}>
      {t('action.label')}
    </button>
  )
}
