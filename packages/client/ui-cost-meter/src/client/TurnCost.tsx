// TurnCost: the per-turn cost chip in a settled turn's tail chain. The
// money/token totals arrive pre-matched by the chain selector from the
// engine-owned Turn, so this component only formats and renders.

import { memo } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatCost, formatTokens } from './cost.ts'
import type { NS } from './locales.ts'
import type { TurnCostData } from './turn-cost.ts'
import css from './Cost.module.css'

/** Registration-side currency threaded through the tail inject face. */
export interface TurnCostInjected {
  currency: string
}

/** Matched turn totals plus the locale and currency seats. */
export type TurnCostProps = { matched: TurnCostData } & PropsLocale<typeof NS> & InjectFace<TurnCostInjected>

/**
 * Render one settled Turn's cost and token total.
 * @param props - matched turn totals, the currency, and the locale seat.
 * @returns the cost chip.
 */
export const TurnCost = memo(function TurnCost({ matched, currency, t }: TurnCostProps) {
  return (
    <span className={css.turn}>
      {t('cost.turn', {
        cost: formatCost(matched.cost, currency),
        tokens: formatTokens(matched.tokens),
      })}
    </span>
  )
})
