/** `cost` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'cost'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'cost.total': '总费用 {cost} · {tokens} tok',
  'cost.turn': '费用 {cost} · {tokens} tok',
}

/** English dictionary (same key set). */
export const en: Record<CostKey, string> = {
  'cost.total': 'Total {cost} · {tokens} tok',
  'cost.turn': 'Cost {cost} · {tokens} tok',
}

/** Union of this namespace's dictionary keys. */
export type CostKey = keyof typeof zh
