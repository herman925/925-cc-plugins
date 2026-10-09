import { expect, test } from 'claude-code/testing'

import { mountBand } from './test-world'

test('the panel header shows the version from the plugin\'s own manifest', async ($, on) => {
  on('fs.read', async (_$: any, e: any) =>
    ({ value: String(e.path).replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json') ? JSON.stringify({ name: 'team-orchestrator', version: '9.9.99' }) : undefined }) as any,
  )
  const band = await mountBand($)
  await band.press({ key: 'main' })
  expect(JSON.stringify(await band.drawn())).toContain('v9.9.99')
})
