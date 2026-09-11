/**
 * Turn-scoped cost derivation, read from the engine-owned closing Turn once a
 * settled turn reaches the tail chain. Pure and testable apart from its
 * optional diagnostic callback: it consumes only the per-step owner currency
 * and the pricing table.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { billedAt, boundedInputTokens, costOf, modelPrice, normalizeUsage, ratesAt } from './cost.ts'
import type { ModelPrice, OffPeakPolicy } from './cost.ts'

/** Money and token facts for one settled Turn. */
export interface TurnCostData {
  readonly cost: number
  readonly tokens: number
}

/**
 * Summarize one settled Turn's billed usage into money and token totals.
 *
 * The token total sums every assistant step's usable usage, which matches the
 * turn-usage disclosure beside the chip except on a retried step: the folded
 * step keeps the settled attempt's usage while that disclosure counts every
 * attempt. Cost prices each step at
 * its OWN closing model route — the `assistant-step` final node's provenance —
 * and at the peak or off-peak rates in force at that step's request time, so a
 * turn that switches models between steps bills each step at the rate of the
 * model that produced it, and a turn that straddles a peak boundary bills each
 * step by the window it ran in. A step with no usable usage, no attributed
 * model, or a model absent from the pricing table contributes nothing to COST
 * (its tokens still count toward the total). Returns null when no step can be
 * priced, so the tail chip declines before mounting.
 * @param owner - Turn-tail owner currency for the settled Turn.
 * @param pricing - the effective pricing table.
 * @param policy - the peak/off-peak schedule; defaults to the published one.
 * @param onUnpricedModel - called with the model id of each step the table
 * cannot price, so a renamed or newly added id is diagnosable instead of
 * silently unpriced; the caller dedups repeated ids.
 * @returns money/token totals, or null when the Turn cannot be priced.
 */
export function turnCostOf(
  owner: TurnTailOwnerProps,
  pricing: Readonly<Record<string, ModelPrice>>,
  policy?: OffPeakPolicy,
  onUnpricedModel?: (model: string) => void,
): TurnCostData | null {
  let cost = 0
  let tokens = 0
  let priced = false
  for (const step of owner.turn.steps) {
    const assistant = step.data.get('assistant-step')
    const buckets = normalizeUsage(assistant?.usage)
    if (buckets === null) continue
    tokens += boundedInputTokens(buckets) + buckets.output
    const node = assistant?.finalNode
    if (node === undefined) continue
    const model = node.provenance?.model
    if (model === undefined) continue
    const price = modelPrice(pricing, model)
    if (price === undefined) {
      onUnpricedModel?.(model)
      continue
    }
    priced = true
    cost += costOf(buckets, ratesAt(price, billedAt(node), policy))
  }
  if (!priced) return null
  return cost > 0 || tokens > 0 ? { cost, tokens } : null
}
