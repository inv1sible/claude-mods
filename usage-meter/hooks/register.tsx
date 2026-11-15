import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Breakdown, Snap, Stats } from '../types'

const PANE = 'usage-meter'
const TITLE = 'Usage'
const HOUR = 3_600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 168 * HOUR }
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'Week', spend_limit: 'Spend' }

const EMPTY: Stats = {
  turns: 0, turnMs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tools: {}, toolErrors: 0,
}
const snap = atom({ plugin: 'usage-meter', key: 'snap' } as const, null, { shape: 'snap-1' })
const stats = atom({ plugin: 'usage-meter', key: 'stats' } as const, EMPTY, { shape: 'stats-1' })
const breakdown = atom({ plugin: 'usage-meter', key: 'breakdown' } as const, null, { shape: 'bd-1' })
const tick = atom({ plugin: 'usage-meter', key: 'tick' } as const, 0)

// ---------- pure helpers ----------

const fmtN = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`

const fmtDur = (ms: number) => {
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

const toSnap = (u: SessionUsage): Snap => ({
  tokens: u.context.tokens,
  window: u.context.window,
  percent: u.context.percent,
  rateLimits: u.rateLimits,
  usd: u.cost?.usd,
  startedAt: u.startedAt,
})

type Pace = { resetIn?: number; projected?: number; hitsIn?: number }

/** Linear projection of a window's use to its reset, from how far into it we are. */
const pace = (r: SessionRateLimit, now: number): Pace => {
  const resetAt = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  if (Number.isNaN(resetAt)) return {}
  const resetIn = resetAt - now
  const len = WINDOW_MS[r.kind]
  if (!len) return { resetIn }
  const elapsed = len - resetIn
  if (elapsed < len * 0.05 || r.percentUsed <= 0) return { resetIn }
  const rate = r.percentUsed / elapsed // % per ms
  const projected = Math.round(r.percentUsed + rate * resetIn)
  const toFull = (100 - r.percentUsed) / rate
  return { resetIn, projected, hitsIn: toFull < resetIn ? toFull : undefined }
}

const statusText = (s: Snap | null, now: number) => {
  if (!s) return undefined
  const parts = s.rateLimits.map(r => {
    const p = pace(r, now)
    const warn = p.hitsIn !== undefined ? '!' : ''
    return `${LABEL[r.kind] ?? r.kind} ${r.percentUsed}%${warn}${p.resetIn !== undefined ? ` ↻${fmtDur(p.resetIn)}` : ''}`
  })
  parts.push(`ctx ${s.percent ?? 0}%`)
  if (s.usd !== undefined) parts.push(`$${s.usd.toFixed(2)}`)
  return parts.join(' · ')
}

const colorFor = (pct: number) => (pct >= 90 ? 'error' : pct >= 70 ? 'warning' : 'success')

// ---------- effects ----------

const refresh = async ($: EngineInterface, u?: SessionUsage) => {
  const usage = u ?? (await $.session.usage())
  const s = toSnap(usage)
  await update($, snap, () => s)
  $.ui.status(statusText(s, await $.clock.now()))
}

const refreshBreakdown = async ($: EngineInterface) => {
  // "summary" is a local estimate: no token-count API calls.
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  if (!b) return
  const cats = b.categories
    .filter(c => c.kind === 'used' && c.tokens > 0)
    .sort((a, z) => z.tokens - a.tokens)
    .slice(0, 6)
    .map(c => ({ name: c.name, tokens: c.tokens }))
  const next: Breakdown = { model: b.model, max: b.rawMaxTokens, compactAt: b.autoCompactThreshold, cats }
  await update($, breakdown, () => next)
  await refresh($, u)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'usage-meter', description: 'Show the usage pane (limits, context, cost)' })
    await refresh($).catch(() => undefined)
    await refreshBreakdown($).catch(() => undefined)
    // Keep reset countdowns fresh in the status line and pane.
    $.clock.every(60_000, () => {
      void update($, tick, n => (n ?? 0) + 1)
      void read($, snap).then(async s => $.ui.status(statusText(s, await $.clock.now())))
    })
    void $.ui.open({ id: PANE, title: TITLE })
    return started
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    await refreshBreakdown($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: statusText(await read($, snap), await $.clock.now()) ?? 'No usage yet.' }
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'usage-meter: could not open the pane.' }))

  on('session.measure', async ($, e, next) => {
    await update($, snap, prev => ({
      tokens: e.context.tokens,
      window: e.context.window,
      percent: e.context.percent,
      rateLimits: e.rateLimits,
      usd: e.cost?.usd,
      startedAt: prev?.startedAt ?? 0,
    }))
    $.ui.status(statusText(await read($, snap), await $.clock.now()))
    if (e.changed.includes('context')) void refreshBreakdown($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const u = e.usage
    await update($, stats, s => ({
      ...s,
      turns: s.turns + (e.agentId ? 0 : 1),
      turnMs: s.turnMs + (e.agentId ? 0 : e.durationMs),
      input: s.input + (u?.input_tokens ?? 0),
      output: s.output + (u?.output_tokens ?? 0),
      cacheRead: s.cacheRead + (u?.cache_read_input_tokens ?? 0),
      cacheWrite: s.cacheWrite + (u?.cache_creation_input_tokens ?? 0),
    }))
    return done
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const failed = ran.deny === undefined && ran.isError === true
    await update($, stats, s => ({
      ...s,
      tools: { ...s.tools, [e.tool]: (s.tools[e.tool] ?? 0) + 1 },
      toolErrors: s.toolErrors + (failed ? 1 : 0),
    }))
    return ran
  }).catch(($, e, next) => next(e)) // a stats failure must never block a tool

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Progress, Button } = $.ui.resolve(e)
    await read($, tick) // subscribe: redraw each minute
    const s = await read($, snap)
    const st = await read($, stats)
    const bd = await read($, breakdown)
    const now = await $.clock.now()

    if (!s) return <Text dimColor>Waiting for the first response…</Text>

    const limits = s.rateLimits.map(r => {
      const p = pace(r, now)
      const name = LABEL[r.kind] ?? r.kind
      const tail = [
        p.resetIn !== undefined ? `resets in ${fmtDur(p.resetIn)}` : undefined,
        p.projected !== undefined ? `pace → ${p.projected}%` : undefined,
        p.hitsIn !== undefined ? `full in ${fmtDur(p.hitsIn)}` : undefined,
      ].filter(Boolean).join(' · ')
      return { r, name, tail, warn: p.hitsIn !== undefined }
    })
    const ctxPct = s.percent ?? 0

    // Compact form for the desktop app's minimized widget.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column">
          {limits.map(l => (
            <Progress key={l.r.kind} label={l.name} value={l.r.percentUsed} max={100}
              valueText={`${l.r.percentUsed}%`} color={colorFor(l.r.percentUsed)} />
          ))}
          <Progress label="Context" value={ctxPct} max={100} valueText={`${ctxPct}%`} color={colorFor(ctxPct)} />
        </Box>
      )
    }

    const totalIn = st.input + st.cacheRead + st.cacheWrite
    const cacheHit = totalIn > 0 ? Math.round((st.cacheRead / totalIn) * 100) : undefined
    const elapsed = s.startedAt > 0 ? now - s.startedAt : 0
    const burn = s.usd !== undefined && elapsed > 5 * 60_000 ? s.usd / (elapsed / HOUR) : undefined
    const toolCount = Object.values(st.tools).reduce((a, b) => a + b, 0)
    const topTools = Object.entries(st.tools).sort((a, z) => z[1] - a[1]).slice(0, 5)
    const room = s.tokens !== undefined && bd?.compactAt ? bd.compactAt - s.tokens : undefined

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>Rate limits</Text>
          {limits.length === 0 && <Text dimColor>No subscription limits reported (API key or no response yet).</Text>}
          {limits.map(l => (
            <Box key={l.r.kind} flexDirection="column">
              <Progress label={l.name} value={Math.min(l.r.percentUsed, 100)} max={100}
                valueText={`${l.r.percentUsed}%`} color={colorFor(l.r.percentUsed)} />
              {l.tail !== '' && <Text dimColor={!l.warn} color={l.warn ? 'warning' : undefined}>  {l.tail}</Text>}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>Context{bd ? ` · ${bd.model}` : ''}</Text>
          <Progress label="Window" value={ctxPct} max={100}
            valueText={`${fmtN(s.tokens ?? 0)} / ${fmtN(s.window)} (${ctxPct}%)`} color={colorFor(ctxPct)} />
          {room !== undefined && <Text dimColor>  auto-compact in ~{fmtN(Math.max(0, room))} tokens</Text>}
          {bd?.cats.map(c => (
            <Text key={c.name} dimColor>  {c.name}: {fmtN(c.tokens)}</Text>
          ))}
        </Box>

        <Box flexDirection="column">
          <Text bold>Session</Text>
          <Text>Cost: {s.usd !== undefined ? `$${s.usd.toFixed(2)}` : 'n/a'}{burn !== undefined ? `  ($${burn.toFixed(2)}/h)` : ''}</Text>
          <Text>Duration: {fmtDur(elapsed)} · turns {st.turns}{st.turns > 0 ? ` · avg ${Math.round(st.turnMs / st.turns / 1000)}s` : ''}</Text>
          <Text>Tokens: in {fmtN(totalIn)} · out {fmtN(st.output)}{cacheHit !== undefined ? ` · cache hit ${cacheHit}%` : ''}</Text>
          <Text>Tools: {toolCount}{st.toolErrors > 0 ? ` (${st.toolErrors} failed)` : ''}</Text>
          {topTools.map(([name, n]) => (
            <Text key={name} dimColor>  {name}: {n}</Text>
          ))}
        </Box>

        <Button key="refresh" label="Refresh" onPress={() => void refreshBreakdown($).catch(() => undefined)} />
      </Box>
    )
  })
}
