import type { Register } from 'claude-code'

import { registerSessionPanel } from './session-panel'

export const register: Register = (on, options) => {
  registerSessionPanel(on, options)
}
