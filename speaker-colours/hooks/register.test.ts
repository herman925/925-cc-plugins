import { expect, test } from 'claude-code/testing'

test('user and assistant rows keep drawing (wrapped, not refused)', async ($, on) => {
  // Stand in for the engine's own drawing beneath the mod.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: ['engine row'] }))

  const user = await $.ui.mount({
    plugin: 'speaker-colours',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: 'hello', origin: { kind: 'user' }, isExpanded: true } as never,
  })
  expect(user).toBeDefined()

  const reply = await $.ui.mount({
    plugin: 'speaker-colours',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'hi there', isFirstOfReply: true } as never,
  })
  expect(reply).toBeDefined()
})
