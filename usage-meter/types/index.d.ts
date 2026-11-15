export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snap = {
  tokens?: number
  window: number
  percent?: number
  rateLimits: Limit[]
  usd?: number
  startedAt: number
}

export type Stats = {
  turns: number
  turnMs: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  tools: Record<string, number>
  toolErrors: number
}

export type Cat = { name: string; tokens: number }
export type Breakdown = { model: string; max: number; compactAt?: number; cats: Cat[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      snap: Shaped<Snap | null>
      stats: Shaped<Stats>
      breakdown: Shaped<Breakdown | null>
      tick: number
    }
  }
}
