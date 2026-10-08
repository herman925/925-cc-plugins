import type { Register } from 'claude-code'

import { registerCleanView } from './clean-view'

export const register: Register = (on, options) => {
  registerCleanView(on, options)
}
