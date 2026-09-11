// @vitest-environment jsdom
/**
 * ui-cost-meter browser half: the turn-cost derivation over engine-published
 * Turn data, the summed session line, the two renderers, and the plugin
 * registrations' fiber-teardown removal (HMR safety) against the real
 * SlotRegistry.
 */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {
  ConversationLocationDataSource, ConversationLocationDataStore, ConversationStepDataMap, ConversationTurnDataMap,
  TurnLocation, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UseConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveOffPeakPolicy, resolvePricing, type CostMeterConfig, type ModelPrice } from '../src/client/cost.ts'
import { turnCostOf, type TurnCostData } from '../src/client/turn-cost.ts'
import { apply, inject } from '../src/client/index.ts'
import { TotalCost } from '../src/client/TotalCost.tsx'
import { TurnCost } from '../src/client/TurnCost.tsx'
import { zh } from '../src/client/locales.ts'

/** Monday 02:00 UTC — inside a published peak window. */
const PEAK = Date.UTC(2026, 8, 7, 2)
/** Monday 05:00 UTC — between the two published peak windows. */
const OFF_PEAK = Date.UTC(2026, 8, 7, 5)

afterEach(() => {
  cleanup()
})

class TestDataStore<M extends object> implements ConversationLocationDataStore<M> {
  private readonly values = new Map<string, unknown>()
  get<Key extends keyof M & string>(
    key: Key,
  ): Readonly<M[Key]> | undefined {
    return this.values.get(key) as Readonly<M[Key]> | undefined
  }
  set<Key extends keyof M & string>(
    key: Key,
    value: M[Key],
  ): void {
    this.values.set(key, value)
  }
  source<Key extends keyof M & string>(key: Key): ConversationLocationDataSource<Readonly<M[Key]> | undefined> {
    return {
      getSnapshot: () => this.get(key),
      subscribe: () => () => {},
    }
  }
}

/** One step's billed usage plus the run that produced it. */
interface StepInput {
  usage: object
  model?: string
  /** Attach a final node that carries no model provenance (usage the plugin cannot attribute). */
  unattributed?: true
  /** Request time in epoch ms; defaults to a peak instant. */
  time?: number
  /** Recorded step start, which takes precedence over `time` when present. */
  start?: number
}

function step(turn: number, stepNo: number, input: StepInput): TurnLocation['steps'][number] {
  const store = new TestDataStore<ConversationStepDataMap>()
  const attributed = input.model !== undefined
  const finalNode = attributed || input.unattributed === true
    ? {
      ...(attributed ? { provenance: { model: input.model } } : {}),
      time: input.time ?? PEAK,
      ...input.start === undefined ? {} : { timing: { stepStartTime: input.start } },
    }
    : undefined
  store.set('assistant-step' as never, {
    usage: input.usage,
    ...finalNode === undefined ? {} : { finalNode },
  } as never)
  return { turn, step: stepNo, start: undefined, end: undefined, status: 'closed', data: store }
}

function owner(steps: readonly StepInput[]): TurnTailOwnerProps {
  const turn: TurnLocation = {
    turn: 1,
    start: undefined,
    end: undefined,
    status: 'closed',
    steps: steps.map((input, index) => step(1, index + 1, input)),
    data: new TestDataStore<ConversationTurnDataMap>(),
  }
  return { turn, seq: 9, openFile: () => {} }
}

const PRICES: Readonly<Record<string, ModelPrice>> = resolvePricing({})

describe('turnCostOf', () => {
  it('prices each assistant step at that step\'s own model', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
      { usage: { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-pro' },
    ]), PRICES)
    expect(value).not.toBeNull()
    // Step 1 priced at flash peak (input 3), step 2 at pro peak (output 27).
    expect(value!.cost).toBeCloseTo(3 + 27)
    expect(value!.tokens).toBe(2_000_000)
  })

  it('prices only priced steps but counts the turn\'s full billed usage', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
      { usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'unknown-model' },
    ]), PRICES)
    expect(value).not.toBeNull()
    // Only the priced step contributes cost; both steps count toward tokens, so
    // the chip's token total matches the turn-usage disclosure.
    expect(value!.cost).toBeCloseTo(3)
    expect(value!.tokens).toBe(3_000_000)
  })

  it('halves the rate for a step that ran off-peak', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp', time: OFF_PEAK },
    ]), PRICES)
    expect(value!.cost).toBeCloseTo(1.5)
  })

  it('bills at the recorded step start rather than the completion time', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp', time: OFF_PEAK, start: PEAK },
    ]), PRICES)
    expect(value!.cost).toBeCloseTo(3)
  })

  it('honours a configured schedule', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp', time: PEAK },
    ]), PRICES, { peakWindows: [], offPeakFactor: 0.25 })
    expect(value!.cost).toBeCloseTo(0.75)
  })

  it('counts an unattributable step\'s tokens without pricing it', () => {
    const value = turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
      { usage: { inputTokens: 5, outputTokens: 5 }, unattributed: true },
    ]), PRICES)
    expect(value).not.toBeNull()
    expect(value!.cost).toBeCloseTo(3)
    expect(value!.tokens).toBe(1_000_010)
  })

  it('declines when a priced step carries no billed usage', () => {
    expect(turnCostOf(owner([
      { usage: { inputTokens: 0, outputTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
    ]), PRICES)).toBeNull()
  })

  it('returns null without a price, without usable usage, or without a model', () => {
    expect(turnCostOf(owner([{ usage: { inputTokens: 5, outputTokens: 5 }, model: 'unknown-model' }]), PRICES)).toBeNull()
    // A step without usage does not zero the turn; a turn with no step is null.
    expect(turnCostOf(owner([]), PRICES)).toBeNull()
    expect(turnCostOf(owner([{ usage: { inputTokens: -1, outputTokens: 5 }, model: 'deepseek-v4-flash-vision-exp' }]), PRICES)).toBeNull()
    // A step with usable usage but no attributed model is never priced, so the
    // turn still declines even though its tokens are counted.
    expect(turnCostOf(owner([{ usage: { inputTokens: 5, outputTokens: 5 } }]), PRICES)).toBeNull()
  })

  it('reports a named model the table cannot price and stays silent otherwise', () => {
    const seen: string[] = []
    turnCostOf(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
      { usage: { inputTokens: 5, outputTokens: 5 }, unattributed: true },
      { usage: { inputTokens: 5, outputTokens: 5 }, model: 'renamed-model' },
      { usage: { inputTokens: 5, outputTokens: 5 }, model: 'renamed-model' },
    ]), PRICES, undefined, model => seen.push(model))
    // A priced step and a step carrying no model report nothing; every
    // unpriceable step reports, and the registration sink owns deduplication.
    expect(seen).toEqual(['renamed-model', 'renamed-model'])
  })
})

describe('TotalCost', () => {
  /** Build a ConversationSnapshot whose `chat` legacy slice carries the given nodes. */
  function snapshot(nodes: readonly object[]): ConversationSnapshot {
    return {
      views: {
        get: (target: string) => target === 'chat' ? { legacy: { nodes } } : undefined,
      },
      activeTargets: new Set(),
    } as unknown as ConversationSnapshot
  }

  function props(
    nodes: readonly object[],
    onUnpricedModel: (model: string) => void = () => {},
  ) {
    const useConversation: UseConversation = selector => selector(snapshot(nodes))
    return {
      useConversation, t: makeTranslate(zh), pricing: PRICES,
      policy: resolveOffPeakPolicy({}), currency: '¥', onUnpricedModel,
    }
  }

  const node = (model: string, usage: object, time = PEAK) =>
    ({ kind: 'assistant', provenance: { provider: 'deepseek', model }, usage, time })
  const prompt = (tokens: number) => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const completion = (tokens: number) => ({ inputTokens: 0, outputTokens: tokens, cacheReadTokens: 0, cacheWriteTokens: 0 })

  it('sums the loaded nodes, each priced at its own model', () => {
    const view = render(<TotalCost {...props([
      node('deepseek-v4-flash-vision-exp', prompt(1_000_000)),
      node('deepseek-v4-pro', completion(1_000_000)),
    ])} />)
    // flash peak input 1M × 3 plus pro peak output 1M × 27.
    expect(view.getByText(/总费用/).textContent).toContain('¥30.00')
    expect(view.getByText(/总费用/).textContent).toContain('2M tok')
  })

  it('bills each node by the window it ran in', () => {
    const view = render(<TotalCost {...props([
      node('deepseek-v4-flash-vision-exp', prompt(1_000_000), OFF_PEAK),
    ])} />)
    expect(view.getByText(/总费用/).textContent).toContain('¥1.50')
  })

  it('reports a node whose model the table cannot price', () => {
    const seen: string[] = []
    const view = render(<TotalCost {...props(
      [node('renamed-model', prompt(5))],
      model => seen.push(model),
    )} />)
    expect(view.container.textContent).toBe('')
    expect(seen).toEqual(['renamed-model'])
  })

  it('renders nothing until a loaded node can be priced', () => {
    const noNodes = render(<TotalCost {...props([])} />)
    expect(noNodes.container.textContent).toBe('')
    noNodes.unmount()
    // A non-assistant node, a node with no model, a node with no usage, and a
    // node with an unknown model all leave nothing priced.
    const unpriced = render(<TotalCost {...props([
      { kind: 'user' },
      { kind: 'assistant', usage: prompt(5), time: PEAK },
      { kind: 'assistant', provenance: { provider: 'deepseek', model: 'deepseek-v4-flash-vision-exp' }, time: PEAK },
      { kind: 'assistant', provenance: { provider: 'deepseek', model: 'unknown-model' }, usage: prompt(5), time: PEAK },
    ])} />)
    expect(unpriced.container.textContent).toBe('')
    unpriced.unmount()
    // A priced node with zero billed usage leaves nothing to show.
    const zero = render(<TotalCost {...props([
      node('deepseek-v4-flash-vision-exp', { inputTokens: 0, outputTokens: 0 }),
    ])} />)
    expect(zero.container.textContent).toBe('')
    zero.unmount()
    // A snapshot that carries no chat view at all contributes nothing.
    const useConversation: UseConversation = selector => selector({
      views: { get: () => undefined },
      activeTargets: new Set(),
    } as unknown as ConversationSnapshot)
    const noChat = render(<TotalCost
      useConversation={useConversation}
      t={makeTranslate(zh)}
      pricing={PRICES}
      policy={resolveOffPeakPolicy({})}
      currency="¥"
      onUnpricedModel={() => {}}
    />)
    expect(noChat.container.textContent).toBe('')
  })
})

describe('TurnCost', () => {
  it('renders the per-turn cost chip', () => {
    const matched: TurnCostData = { cost: 0.5, tokens: 3_000 }
    const view = render(<TurnCost matched={matched} currency="¥" t={makeTranslate(zh)} />)
    expect(view.getByText(/费用/).textContent).toContain('¥0.5')
    expect(view.getByText(/费用/).textContent).toContain('3K tok')
  })
})

describe('plugin registration', () => {
  /**
   * Capture the two registrations the body makes. The real registry's entry view
   * exposes neither the inject factory nor the selector, so the calls are
   * captured at their own seam.
   */
  function registeredEntries(config: CostMeterConfig = {}): Record<string, unknown>[] {
    const registered: Record<string, unknown>[] = []
    const ctx = {
      effect: (body: () => unknown) => { body() },
      locale: { register: () => {} },
      slots: {
        inject: (_name: string, register: () => unknown) => { register() },
        register: (options: Record<string, unknown>) => { registered.push(options); return () => {} },
      },
    }
    apply(ctx as never, config)
    return registered
  }

  it('registers the dock and tail entries; fiber disposal removes both', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
        'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
      },
    } as never, () => null)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.provide('locale', {
      register: () => {},
      bind: () => () => '',
      revision: { getSnapshot: () => 0, subscribe: () => () => {} },
    } as never)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const dock = ctx.slots.entries('conversation.composer.dock').map(entry => entry?.options.id)
    expect(dock).toContain('cost')
    const tail = ctx.slots.entries('conversation.chat.turnTail').some(entry => entry !== undefined)
    expect(tail).toBe(true)

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.composer.dock').map(entry => entry?.options.id)).not.toContain('cost')
    expect(ctx.slots.entries('conversation.chat.turnTail')).toHaveLength(0)
  })

  it('threads the resolved pricing facts, schedule, and selector into both surfaces', () => {
    // No peak windows plus a quarter factor: the selector can only reach 0.75
    // if it received both the pricing table and this schedule.
    const [dock, tail] = registeredEntries({ currency: '$', peakWindows: [], offPeakFactor: 0.25 })
    expect((dock!.inject as () => unknown)()).toMatchObject({
      currency: '$',
      policy: { peakWindows: [], offPeakFactor: 0.25 },
    })
    expect((tail!.inject as () => unknown)()).toEqual({ currency: '$' })
    // The chip's selector reads the same schedule the dock face carries.
    expect((tail!.select as (owner: TurnTailOwnerProps) => TurnCostData | null)(owner([
      { usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'deepseek-v4-flash-vision-exp' },
    ]))).toMatchObject({ cost: 0.75 })
  })

  it('reports each unpriceable model id once through the wired diagnostic sink', () => {
    const warned: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => {
      warned.push(String(message))
    })
    try {
      const [dock, tail] = registeredEntries()
      const select = tail!.select as (owner: TurnTailOwnerProps) => TurnCostData | null
      const turnWith = (model: string): TurnTailOwnerProps =>
        owner([{ usage: { inputTokens: 5, outputTokens: 5 }, model }])
      select(turnWith('renamed-model'))
      select(turnWith('renamed-model'))
      select(turnWith('other-renamed'))
      const notice = (model: string): string =>
        `[ui-cost-meter] no pricing entry for model "${model}"; add pricing["${model}"] to show its cost`
      expect(warned).toEqual([notice('renamed-model'), notice('other-renamed')])
      // The dock face carries the same sink, so the summed line reports an
      // unpriceable node the tail never sees.
      const dockFace = (dock!.inject as () => { onUnpricedModel: (model: string) => void })()
      dockFace.onUnpricedModel('renamed-model')
      expect(warned).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })
})
