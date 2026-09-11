// TotalCost: the session cost shown beside the composer. It sums every loaded
// assistant node's cost — each priced at its own model and at the peak or
// off-peak rates in force when its request ran — so the line equals the sum of
// the per-turn chips. It reads the loaded conversation window rather than a
// whole-log projection, so a Turn paged or compacted out of the window no
// longer contributes.

import { memo } from 'react'
import type { UseConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: merges the `chat` key into ConversationViewSnapshotMap for useConversation.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { billedAt, boundedInputTokens, costOf, formatCost, formatTokens, modelPrice, normalizeUsage, ratesAt } from './cost.ts'
import type { ModelPrice, OffPeakPolicy } from './cost.ts'
import type { NS } from './locales.ts'
import css from './Cost.module.css'

/** Registration-side pricing facts threaded through the dock inject face. */
export interface TotalCostInjected {
  pricing: Readonly<Record<string, ModelPrice>>
  policy: OffPeakPolicy
  currency: string
  /** Called with the model id of each node the table cannot price; the caller dedups ids. */
  onUnpricedModel: (model: string) => void
}

/** Owner props plus the injected pricing facts. */
export type TotalCostProps = {
  useConversation: UseConversation
} & PropsLocale<typeof NS> & InjectFace<TotalCostInjected>

/**
 * Render the loaded window's summed cost, or nothing until a loaded node can be
 * priced. A node whose attributed model the table cannot price is reported to
 * the inject face's diagnostic sink and left out of the sum.
 * @param props - conversation selector, pricing table, schedule, diagnostic sink, and locale.
 * @returns the cost line, or null when no loaded node can be priced.
 */
export const TotalCost = memo(function TotalCost({
  useConversation, pricing, policy, currency, onUnpricedModel, t,
}: TotalCostProps) {
  const nodes = useConversation(conversation => conversation.views.get('chat')?.legacy.nodes ?? [])
  let cost = 0
  let tokens = 0
  let priced = false
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    const buckets = normalizeUsage(node.usage)
    if (buckets === null) continue
    tokens += boundedInputTokens(buckets) + buckets.output
    const model = node.provenance?.model
    if (model === undefined) continue
    const price = modelPrice(pricing, model)
    if (price === undefined) {
      onUnpricedModel(model)
      continue
    }
    priced = true
    cost += costOf(buckets, ratesAt(price, billedAt(node), policy))
  }
  if (!priced || (cost === 0 && tokens === 0)) return null
  return (
    <p className={css.total}>
      {t('cost.total', { cost: formatCost(cost, currency), tokens: formatTokens(tokens) })}
    </p>
  )
})
