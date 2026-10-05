import type { Register } from 'claude-code'

// Bar colours and the faint wash behind each speaker. Change these to taste.
const USER_COLOR = '#8FC1FF' // light blue
const USER_TINT = '#27384F'
const CLAUDE_COLOR = '#FFA38F' // light orange / salmon
const CLAUDE_TINT = '#4A2F27'

export const register: Register = on => {
  // Your prompts: the engine paints its own grey strip behind the text, which
  // fights the tint. Typed prompts are plain text, so draw them ourselves in the
  // default colour (no colour prop) inside the light-blue bar and tint. Anything
  // else (task notices, peer messages) keeps the engine's drawing.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box borderStyle="quote" borderColor={USER_COLOR} backgroundColor={USER_TINT}>
        <Text>{'❯ ' + e.props.text}</Text>
      </Box>
    )
  })

  // Claude's replies: same, in orange.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const theirs = await next(e)
    const { Box } = $.ui.resolve(e)

    return (
      <Box borderStyle="quote" borderColor={CLAUDE_COLOR} backgroundColor={CLAUDE_TINT}>
        {theirs}
      </Box>
    )
  })
}
