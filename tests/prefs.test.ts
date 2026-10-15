import { describe, expect, test } from 'claude-code/testing'

import { applyCommand, DEFAULT_PREFS, prefsFrom, statusOf } from '../hooks/prefs'

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

  test('band off keeps the engine dialog, band on brings the band back, nothing else moves', async () => {
    expect(DEFAULT_PREFS.band).toBe(true)
    expect(applyCommand(DEFAULT_PREFS, 'band off')).toEqual({ prefs: { ...DEFAULT_PREFS, band: false } })
    expect(applyCommand({ ...DEFAULT_PREFS, band: false }, 'band on')).toEqual({ prefs: DEFAULT_PREFS })
    expect(applyCommand({ ...DEFAULT_PREFS, band: false }, 'reset')).toEqual({ prefs: DEFAULT_PREFS })
  })

  test('band without on or off is refused with the reason', async () => {
    expect(applyCommand(DEFAULT_PREFS, 'band')).toEqual({ error: 'band : on ou off' })
    expect(applyCommand(DEFAULT_PREFS, 'band maybe')).toEqual({ error: 'band : on ou off' })
  })

  test('the status says whether the band is on', async () => {
    expect(statusOf(DEFAULT_PREFS)).toContain('bande on')
    expect(statusOf({ ...DEFAULT_PREFS, band: false })).toContain('bande off')
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

  test('prefs stored before the band setting keep the band, a band that is not a boolean is ignored', async () => {
    const { band, ...older } = { ...DEFAULT_PREFS, theme: 'light' as const }
    expect(prefsFrom(older)).toEqual({ ...DEFAULT_PREFS, theme: 'light', band })
    expect(prefsFrom({ band: false })).toEqual({ ...DEFAULT_PREFS, band: false })
    expect(prefsFrom({ theme: 'light', band: 'no' })).toEqual(DEFAULT_PREFS)
  })
})
