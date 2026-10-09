import { expect, test } from 'claude-code/testing'

import { mountBand } from './test-world'

const manifest = (on: any) =>
  on('fs.read', async (_$: any, e: any) =>
    ({ value: String(e.path).replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json') ? JSON.stringify({ name: 'team-orchestrator', version: '9.9.99' }) : undefined }) as any,
  )

test('the band shows a filled title pill with the version, and the button beside it opens the panel', async ($, on) => {
  manifest(on)
  const band = await mountBand($)
  const pill = (await band.findAll({ type: 'Text' })).find((t: any) => t.props.bold === true && t.props.backgroundColor === 'cyan')
  expect(pill?.text).toContain('Team Orchestrator v9.9.99')
  await band.press({ key: 'main' })
  expect(await band.find({ key: 'tab-roster' })).toBeDefined()
})

test('the panel header shows the version too', async ($, on) => {
  manifest(on)
  const band = await mountBand($)
  await band.press({ key: 'main' })
  expect(JSON.stringify(await band.drawn())).toContain('v9.9.99')
})
