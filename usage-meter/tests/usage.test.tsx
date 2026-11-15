import { expect, test } from 'claude-code/testing'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const PANE = {
  plugin: 'usage-meter',
  component: 'Pane',
  requestId: 'usage-meter',
  props: {
    title: 'Usage', isFocused: false, bodyColumns: 60, placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 }, view: {},
  },
} as const

const USAGE = {
  startedAt: NOW - 2 * 3_600_000,
  context: { tokens: 50_000, window: 200_000, percent: 25 },
  // 5h window 3h in (resets in 2h) at 60% → pace 100%, full in 2h (not before reset).
  // Week window 1d in at 30% → projects 210%, full in ~2.3d.
  rateLimits: [
    { kind: 'five_hour', percentUsed: 60, resetsAt: new Date(NOW + 2 * 3_600_000).toISOString() },
    { kind: 'seven_day', percentUsed: 30, resetsAt: new Date(NOW + 6 * 86_400_000).toISOString() },
  ],
  cost: { usd: 3 },
}

test('status line and pane show limits, pace, context and cost', async ($, on) => {
  let status: string | undefined
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('session.usage', () => ({ value: USAGE }))
  on('command.register', () => ({ value: { command: 'usage-meter' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => ((status = (e as { text?: string }).text), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(status).toBe('5h 60% ↻2h00 · Week 30%! ↻6d0h · ctx 25% · $3.00')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /pace → 100%/ }))?.text).toContain('resets in 2h00')
  expect((await ui.find({ type: 'Text', text: /pace → 210%/ }))?.text).toContain('full in')
  expect((await ui.find({ type: 'Text', text: /^Cost/ }))?.text).toBe('Cost: $3.00  ($1.50/h)')
  expect((await ui.find({ type: 'Text', text: /^Tools/ }))?.text).toBe('Tools: 1')
  await ui.unmount()
})

test('where no pane is placed, /usage-meter draws a card in the chat', async ($, on) => {
  let placedId = ''
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'mobile places no panes' } }))
  on('ui.place', (_, e) => ((placedId = (e as { id: string }).id), { value: { isPlaced: true, requestId: 'r1' } }))

  const ran = await $.command.run({ command: 'usage-meter', args: '' } as never)
  expect(String((ran as { text?: string }).text)).toContain('pane not placed: mobile places no panes')

  const ui = await $.ui.mount({
    plugin: 'usage-meter', component: 'Placed', requestId: 'r1', surface: 'mobile',
    props: { id: placedId, plugin: 'usage-meter' },
  })
  expect((await ui.find({ type: 'Text', text: /^Cost/ }))?.text).toBe('Cost: $3.00  ($1.50/h)')
  await ui.unmount()
})

test('a typed "/usage-meter" prompt that is not a command is caught and kept from the model', async ($, on) => {
  on('clock.now', () => ({ value: NOW }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.surfaces', () => ({ value: ['mobile'] }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'mobile places no panes' } }))
  on('ui.place', () => ({ value: { isPlaced: true, requestId: 'r1' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const caught = await $.prompt.submit({ text: '/usage-meter' } as never)
  expect(String((caught as { drop?: string }).drop)).toContain('5h 60%')
  const other = await $.prompt.submit({ text: 'hello' } as never)
  expect((other as { text?: string }).text).toBe('hello')
})
