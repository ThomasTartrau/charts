import { describe, expect, test } from 'claude-code/testing'

import { applyCommand, DEFAULT_PREFS, prefsFrom } from '../hooks/prefs'

describe('prefs', () => {
  test('each valid /charts argument changes exactly its field', async () => {
    expect(applyCommand(DEFAULT_PREFS, 'off')).toEqual({ prefs: { ...DEFAULT_PREFS, enabled: false } })
    expect(applyCommand({ ...DEFAULT_PREFS, enabled: false }, 'on')).toEqual({ prefs: DEFAULT_PREFS })
    expect(applyCommand(DEFAULT_PREFS, 'theme light')).toEqual({ prefs: { ...DEFAULT_PREFS, theme: 'light' } })
    expect(applyCommand(DEFAULT_PREFS, 'width 80')).toEqual({ prefs: { ...DEFAULT_PREFS, maxColumns: 80 } })
    expect(applyCommand(DEFAULT_PREFS, 'rows 30')).toEqual({ prefs: { ...DEFAULT_PREFS, maxRows: 30 } })
    expect(applyCommand(DEFAULT_PREFS, 'cell 0,45')).toEqual({ prefs: { ...DEFAULT_PREFS, cellAspect: 0.45 } })
    expect(applyCommand({ ...DEFAULT_PREFS, maxColumns: 40 }, 'reset')).toEqual({ prefs: DEFAULT_PREFS })
  })

  test('status and no argument leave the prefs as they are', async () => {
    expect(applyCommand(DEFAULT_PREFS, '')).toEqual({ prefs: DEFAULT_PREFS })
    expect(applyCommand(DEFAULT_PREFS, 'status')).toEqual({ prefs: DEFAULT_PREFS })
  })

  test('out-of-range and unknown arguments are refused with the reason', async () => {
    expect(applyCommand(DEFAULT_PREFS, 'width 10')).toEqual({ error: 'width : entier de 20 à 255' })
    expect(applyCommand(DEFAULT_PREFS, 'width 80.5')).toEqual({ error: 'width : entier de 20 à 255' })
    expect(applyCommand(DEFAULT_PREFS, 'rows 0')).toEqual({ error: 'rows : entier de 3 à 80' })
    expect(applyCommand(DEFAULT_PREFS, 'cell 2')).toEqual({ error: 'cell : nombre de 0.3 à 0.8' })
    expect(applyCommand(DEFAULT_PREFS, 'theme pink')).toEqual({ error: 'thème : dark ou light' })
    const unknown = applyCommand(DEFAULT_PREFS, 'banana')
    expect('error' in unknown && unknown.error.startsWith('argument inconnu : banana')).toBe(true)
  })

  test('a stored value is merged over the defaults, a corrupt one is ignored', async () => {
    expect(prefsFrom(undefined)).toEqual(DEFAULT_PREFS)
    expect(prefsFrom({ theme: 'light' })).toEqual({ ...DEFAULT_PREFS, theme: 'light' })
    expect(prefsFrom({ theme: 'pink' })).toEqual(DEFAULT_PREFS)
    expect(prefsFrom({ maxColumns: 'large' })).toEqual(DEFAULT_PREFS)
  })
})
