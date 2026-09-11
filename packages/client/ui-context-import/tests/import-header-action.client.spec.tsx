// @vitest-environment jsdom
/**
 * The session-header import action: one button whose accessible name is the
 * localized label, and whose click asks the Session's surface to open the
 * dialog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ImportHeaderAction, type ImportHeaderActionProps } from '../src/client/ImportHeaderAction.tsx'
import { en, zh, type ContextImportKey } from '../src/client/locales.ts'

afterEach(cleanup)

/** Props of the header action: the injected open verb plus the translator. */
function props(locale: Record<ContextImportKey, string>, openDialog: () => void): ImportHeaderActionProps {
  return { openDialog, t: makeTranslate(locale) } as unknown as ImportHeaderActionProps
}

describe('ImportHeaderAction', () => {
  it('names the trigger with the Chinese label and opens the dialog when clicked', () => {
    const openDialog = vi.fn()
    render(<ImportHeaderAction {...props(zh, openDialog)} />)

    const trigger = screen.getByRole('button', { name: '导入会话' })
    expect(trigger.textContent).toBe(zh['action.label'])
    fireEvent.click(trigger)
    expect(openDialog).toHaveBeenCalledTimes(1)
  })

  it('carries the English label under the English dictionary', () => {
    render(<ImportHeaderAction {...props(en, vi.fn())} />)
    expect(screen.getByRole('button', { name: 'Import session' })).toBeDefined()
  })
})
