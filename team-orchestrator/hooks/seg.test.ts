import { expect, test } from 'claude-code/testing'
import { adopt, mountBand, world } from './test-world'

// Every row of options (Show / Hide, the layout, the levels...) is drawn by one helper, Seg: the chosen option is
// coloured text in "[ label ]" shape, the others stay pressable buttons.
const CHOSEN = '#ff5440'

test('in Settings the chosen option of Show / Hide is #ff5440 and the other stays a plain button; pressing it moves the colour', async ($, on) => {
  world(on, [{ handle: 'term_c1', title: '✳ Hualong CEO' }], [])
  await adopt($, [{ name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c1' }])
  const band = await mountBand($, 120)
  await band.press({ key: 'settings' })
  const at = async (key: string) => JSON.stringify(await band.find({ key }))
  // the org chart starts shown: Show is chosen
  expect(await at('chart-1')).toContain(CHOSEN)
  expect(await at('chart-1')).toContain('[ Show ]')
  expect(await at('chart-0')).not.toContain(CHOSEN)
  expect((await band.find({ key: 'chart-0' }) as any).type).toBe('Button')
  await band.press({ key: 'chart-0' })
  expect(await at('chart-0')).toContain(CHOSEN)
  expect(await at('chart-0')).toContain('[ Hide ]')
  expect(await at('chart-1')).not.toContain(CHOSEN)
  expect((await band.find({ key: 'chart-1' }) as any).type).toBe('Button')
})

test('the layout row gets the same colour from the same helper', async ($, on) => {
  world(on, [{ handle: 'term_c2', title: '✳ Hualong CEO' }], [])
  await adopt($, [{ name: 'Hualong CEO', role: 'ceo', level: 1, boss: 'user', handle: 'term_c2' }])
  const band = await mountBand($, 120)
  await band.press({ key: 'settings' })
  expect(JSON.stringify(await band.find({ key: 'layout-stacked' }))).toContain(CHOSEN)
  expect(JSON.stringify(await band.find({ key: 'layout-columns' }))).not.toContain(CHOSEN)
})
