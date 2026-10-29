import { expect, test } from 'claude-code/testing'

import { parseCleanupReport } from './housekeeping'

test('only explicit cleanup fields are stored as worker reports; they are never OS verified', () => {
  expect(parseCleanupReport('Done. Cleanup: clean.')).toEqual({ status: 'reported-clean', verified: false })
  expect(parseCleanupReport('Done. Cleanup status: incomplete; one exact file remains.')).toEqual({ status: 'reported-incomplete', verified: false })
  expect(parseCleanupReport('Done. Housekeeping: failed.')).toEqual({ status: 'reported-incomplete', verified: false })
  expect(parseCleanupReport('Done. Cleanup: unverified.')).toEqual({ status: 'unverified', verified: false })
})

test('do not infer completion or clean status from ordinary prose', () => {
  for (const text of [
    'Not done; build is still running.',
    'Progress: parser done; tests still running.',
    'Waiting for the user.',
    'Clean report will be sent later.',
    'Done. Cleanup is unclear.',
  ]) expect(parseCleanupReport(text)).toBeUndefined()
})

test('incomplete or remaining resources override a clean label', () => {
  expect(parseCleanupReport('Cleanup: clean; not clean yet, one process remains.')).toEqual({ status: 'reported-incomplete', verified: false })
  expect(parseCleanupReport('Cleanup: clean; cleanup incomplete.')).toEqual({ status: 'reported-incomplete', verified: false })
  for (const residue of ['2 left', 'one process kept', 'report retained', 'the output still exists'])
    expect(parseCleanupReport(`Cleanup: clean; ${residue}.`)).toEqual({ status: 'reported-incomplete', verified: false })
})

test('long completion reports parse without a length cutoff; trailing words do not become new requests', () => {
  const long = `Task complete. Cleanup: clean. ${'Active harness shell retained. '.repeat(100)}`
  expect(parseCleanupReport(long)).toEqual({ status: 'reported-incomplete', verified: false })
})
