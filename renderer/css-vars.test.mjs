import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveCssVars } from './css-vars.mjs'

test('a var() takes the value set on the svg element', () => {
  const svg = '<svg style="--fg:#e8e6df"><rect fill="var(--fg)"/></svg>'
  assert.equal(resolveCssVars(svg), '<svg style="--fg:#e8e6df"><rect fill="#e8e6df"/></svg>')
})

test('an undefined var() falls back, and the fallback is resolved too', () => {
  const svg = '<svg style="--bg:#000000;--fg:#ffffff"><rect fill="var(--muted, color-mix(in srgb, var(--fg) 25%, var(--bg)))"/></svg>'
  assert.match(resolveCssVars(svg), /fill="#404040"/)
})

test('a chain of variables through a style block resolves to the final color', () => {
  const svg = '<svg style="--accent:#3987e5"><style>svg { --_arrow: var(--accent, #999999); }</style><path stroke="var(--_arrow)"/></svg>'
  assert.match(resolveCssVars(svg), /stroke="#3987e5"/)
})

test('the remote font import is dropped: resvg has no network', () => {
  const svg = "<svg><style>@import url('https://fonts.googleapis.com/css2?family=Inter');text{}</style></svg>"
  assert.doesNotMatch(resolveCssVars(svg), /@import/)
})

test('a mix of a non-hex color is left as written rather than guessed', () => {
  const svg = '<svg style="--fg:red;--bg:#000000"><rect fill="var(--x, color-mix(in srgb, var(--fg) 50%, var(--bg)))"/></svg>'
  assert.match(resolveCssVars(svg), /fill="color-mix\(in srgb, red 50%, #000000\)"/)
})
