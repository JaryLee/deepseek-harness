/**
 * Cost meter plugin, browser half: registers the durable session cost line on
 * the composer dock and the per-turn cost chip in each settled turn's tail.
 *
 * All pricing policy lives here — the pricing table, the currency, and the two
 * renderers — so composing this plugin out of cordis.yml removes both surfaces
 * entirely; the dock and tail holes render nothing at zero cost.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TotalCost } from './TotalCost.tsx'
import { TurnCost } from './TurnCost.tsx'
import { en, NS, zh, type CostKey } from './locales.ts'
import { resolveOffPeakPolicy, resolvePricing, type CostMeterConfig } from './cost.ts'
import { turnCostOf } from './turn-cost.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cost meter copy. */
    'cost': CostKey
  }
}

/** Required services for the dock and tail-slot registrations and their dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the two cost entries.
 *
 * A model id the effective table cannot price renders no cost, so the surfaces
 * would go blank for a renamed or newly added model with nothing naming the
 * cause; the body owns one diagnostic sink that reports each unpriceable id
 * once per plugin instance.
 * @param ctx - client root context.
 * @param config - plugin config; the rate table and the schedule are validated
 * here, and pricing merges over the built-in reference.
 */
export function apply(ctx: ClientContext, config: CostMeterConfig = {}): void {
  const currency = config.currency ?? '¥'
  const pricing = resolvePricing(config)
  const policy = resolveOffPeakPolicy(config)
  const reported = new Set<string>()
  const onUnpricedModel = (model: string): void => {
    if (reported.has(model)) return
    reported.add(model)
    console.warn(
      `[ui-cost-meter] no pricing entry for model "${model}"; add pricing["${model}"] to show its cost`,
    )
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-cost-meter: dictionaries')
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'cost',
    order: 1,
    locale: NS,
    inject: () => ({ pricing, policy, currency, onUnpricedModel }),
  }, TotalCost))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: (owner: TurnTailOwnerProps) => turnCostOf(owner, pricing, policy, onUnpricedModel),
    locale: NS,
    inject: () => ({ currency }),
  }, TurnCost))
}
