/**
 * The desktop-notify card inside the Plugins settings section: the master
 * switch, what it governs, and the browser permission the notice depends on.
 *
 * The card owns its own chrome — a card cannot import another plugin's — and
 * writes each switch straight through the injected face, so the Host document
 * is the only state.
 */

import type { ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: ui-settings-plugins declares the keyed settings.plugin.item slot.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { DesktopNotifyCardFace } from './card-controller.ts'
import type { NotificationPermissionState } from './permission.ts'
import { NS, type DesktopNotifyKey } from './locales.ts'
import css from './card.module.css'

/** Localized name of each permission state. */
const PERMISSION_LABEL: Record<NotificationPermissionState, DesktopNotifyKey> = {
  granted: 'permission.granted',
  denied: 'permission.denied',
  default: 'permission.default',
  unsupported: 'permission.unsupported',
}

/** Props the renderer binds for the card. */
export type DesktopNotifyCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<typeof NS>
  & InjectFace<DesktopNotifyCardFace>

/**
 * Render the desktop-notify card.
 * @param props - locale copy, the card snapshot, and its switch actions.
 * @returns the card, or nothing while the Host serves no such namespace.
 */
export function DesktopNotifyCard(props: DesktopNotifyCardProps) {
  const { t } = props
  const state = props.useDesktopNotifyCard(snapshot => snapshot)
  if (!state.available) return null
  const locked = !state.writable
  return (
    <li className={css.card}>
      <div className={css.head}>
        <span className={css.name}>{t('card.title')}</span>
        <span className={css.description}>{t('card.description')}</span>
      </div>
      <div className={css.body}>
        <SettingRow label={t('field.enabled')} hint={t('field.enabled.hint')}>
          <Switch
            checked={state.enabled}
            disabled={locked}
            label={t('field.enabled')}
            onChange={(next) => { props.setEnabled(next) }}
          />
        </SettingRow>
        <SettingRow label={t('field.onlyWhenHidden')} hint={t('field.onlyWhenHidden.hint')}>
          <Switch
            checked={state.onlyWhenHidden}
            disabled={locked || !state.enabled}
            label={t('field.onlyWhenHidden')}
            onChange={(next) => { props.setOnlyWhenHidden(next) }}
          />
        </SettingRow>
        <SettingRow label={t('field.onQuestion')} hint={t('field.onQuestion.hint')}>
          <Switch
            checked={state.onQuestion}
            disabled={locked || !state.enabled}
            label={t('field.onQuestion')}
            onChange={(next) => { props.setOnQuestion(next) }}
          />
        </SettingRow>
        <SettingRow label={t('field.sound')} hint={t('field.sound.hint')}>
          <Switch
            checked={state.sound}
            disabled={locked || !state.enabled}
            label={t('field.sound')}
            onChange={(next) => { props.setSound(next) }}
          />
        </SettingRow>
        <div className={css.permission}>
          <div className={css.permissionHead}>
            <span className={css.label}>{t('permission.label')}</span>
            <span className={css.permissionValue}>{t(PERMISSION_LABEL[state.permission])}</span>
            {state.permission === 'default'
              ? (
                <button
                  type="button"
                  className={css.request}
                  disabled={locked}
                  onClick={() => { props.requestPermission() }}
                >
                  {t('permission.request')}
                </button>
              )
              : null}
          </div>
          <p className={css.hint}>{t('permission.hint')}</p>
        </div>
      </div>
    </li>
  )
}

/** One labelled switch: the control and what it governs, in one row. */
function SettingRow(props: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <span className={css.label}>{props.label}</span>
        <p className={css.hint}>{props.hint}</p>
      </div>
      {props.children}
    </div>
  )
}
