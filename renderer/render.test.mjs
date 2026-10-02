// node --test : le renderer de bout en bout, vrai vega et vrai resvg.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'render.mjs')
const BAR = {
  // un nonce par run, pour que le premier rendu ne soit jamais servi par le cache
  data: { values: [{ cas: `froid-${process.pid}-${Date.now()}`, s: 540 }, { cas: 'chaud', s: 95 }] },
  mark: 'bar',
  encoding: { x: { field: 'cas', type: 'nominal' }, y: { field: 's', type: 'quantitative' } },
}

function render(input) {
  const run = spawnSync('node', [SCRIPT], { input: JSON.stringify(input), encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('a bar chart becomes a PNG of the asked width, capped in height', () => {
  const out = render({ spec: BAR, width: 640, maxHeight: 200, theme: 'dark', format: 'png' })
  assert.equal(out.ok, true)
  assert.equal(out.width, 640)
  assert.equal(out.height, 200)
  assert.ok(existsSync(out.file))
  // signature PNG
  assert.deepEqual([...readFileSync(out.file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('the same input again is served from the cache, same file', () => {
  const first = render({ spec: BAR, width: 500, theme: 'light', format: 'png' })
  const again = render({ spec: BAR, width: 500, theme: 'light', format: 'png' })
  assert.deepEqual(again, first)
})

test('svg format returns the markup itself', () => {
  const out = render({ spec: BAR, width: 400, theme: 'light', format: 'svg' })
  assert.equal(out.ok, true)
  assert.match(out.svg, /^<svg[^>]+width="400"/)
})

/** Le pixel en haut à gauche d'un PNG RGBA 8 bits : sur la première ligne, tout filtre le laisse tel quel. */
function firstPixel(file) {
  const png = readFileSync(file)
  const idat = []
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at)
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  assert.equal(png[25], 6, 'PNG RGBA attendu')
  // octet 0 : le filtre de la ligne, puis R, V, B, A
  return [...inflateSync(Buffer.concat(idat)).subarray(1, 5)]
}

test('opaque fills the theme background, the terminal PNG stays transparent', () => {
  const clear = render({ spec: BAR, width: 400, theme: 'dark', format: 'png' })
  const opaque = render({ spec: BAR, width: 400, theme: 'dark', format: 'png', opaque: true })
  assert.notEqual(opaque.file, clear.file)
  assert.equal(firstPixel(clear.file)[3], 0)
  // #16171a, le fond du thème sombre
  assert.deepEqual(firstPixel(opaque.file), [0x16, 0x17, 0x1a, 255])
})

test('the theme colors the single series with the first palette slot', () => {
  const dark = render({ spec: BAR, width: 400, theme: 'dark', format: 'svg' })
  assert.match(dark.svg, /fill="#3987e5"/)
})

test('a spec vega-lite cannot compile is an error with the reason, not a crash', () => {
  const out = render({ spec: { mark: 'nope' }, width: 400, theme: 'dark', format: 'png' })
  assert.equal(out.ok, false)
  assert.match(out.error, /^spec vega-lite invalide : /)
})

test('a dot diagram becomes a PNG no wider than asked, never scaled up', () => {
  const source = `digraph g${Date.now()} { rankdir=LR; diff -> regles -> score }`
  const out = render({ kind: 'dot', source, width: 900, maxHeight: 352, theme: 'dark', format: 'png' })
  assert.equal(out.ok, true)
  assert.ok(out.width <= 900, `width ${out.width}`)
  assert.ok(existsSync(out.file))
})

test('a huge dot diagram is scaled down to fit both width and height', () => {
  const chain = Array.from({ length: 40 }, (_, i) => `n${i}`).join(' -> ')
  const out = render({ kind: 'dot', source: `digraph { rankdir=LR; ${chain} }`, width: 400, maxHeight: 200, theme: 'dark', format: 'png' })
  assert.equal(out.ok, true)
  assert.ok(out.width <= 400 && out.height <= 200, `${out.width}x${out.height}`)
})

test('the dot svg starts at <svg and uses the terminal font, not the Courier used for layout', () => {
  const out = render({ kind: 'dot', source: 'digraph { a -> b }', width: 400, theme: 'dark', format: 'svg' })
  assert.match(out.svg, /^<svg/)
  assert.doesNotMatch(out.svg, /font-family="Courier/)
  assert.match(out.svg, /font-family="JetBrainsMono Nerd Font/)
})

test('a wide LR dot chain is redrawn top-down when that shrinks it less', () => {
  const chain = Array.from({ length: 12 }, (_, i) => `"étape numéro ${i}"`).join(' -> ')
  const out = render({ kind: 'dot', source: `digraph { rankdir=LR; ${chain} }`, width: 600, maxHeight: 2000, theme: 'dark', format: 'svg' })
  assert.equal(out.ok, true)
  // de haut en bas, la chaîne est plus haute que large
  assert.ok(out.height > out.width, `${out.width}x${out.height}`)
})

test('a mermaid sequence diagram becomes a PNG at its natural size when it fits', () => {
  const source = `sequenceDiagram\n  participant U as Utilisateur${Date.now()}\n  participant G as GitLab\n  U->>G: mention /work\n  G-->>U: MR créée`
  const out = render({ kind: 'mermaid', source, width: 928, maxHeight: 704, theme: 'dark', format: 'png' })
  assert.equal(out.ok, true)
  assert.ok(out.width < 928 && out.height < 704, `${out.width}x${out.height}`)
  assert.ok(existsSync(out.file))
})

test('the mermaid svg has no CSS variable or remote font left for resvg', () => {
  const out = render({ kind: 'mermaid', source: 'flowchart LR\n  A[Diff] --> B{Seuil ?}\n  B -->|oui| C[Commentaire]', width: 600, theme: 'dark', format: 'svg' })
  assert.equal(out.ok, true)
  assert.doesNotMatch(out.svg, /var\(/)
  assert.doesNotMatch(out.svg, /@import/)
  // l'accent du thème est bien arrivé sur les traits des nœuds
  assert.match(out.svg, /#3987e5/i)
})

test('a mermaid type beautiful-mermaid does not draw is an error that names it', () => {
  const out = render({ kind: 'mermaid', source: 'gantt\n  title Planning', width: 600, theme: 'dark', format: 'png' })
  assert.equal(out.ok, false)
  assert.match(out.error, /^mermaid invalide ou type non pris en charge : .*gantt/)
})

test('DOT graphviz cannot parse is an error with the reason', () => {
  const out = render({ kind: 'dot', source: 'digraph { a -> }', width: 400, theme: 'dark', format: 'png' })
  assert.equal(out.ok, false)
  assert.match(out.error, /^DOT invalide : syntax error/)
})

test('bad input is refused with the reason', () => {
  assert.deepEqual(render({ kind: 'plantuml', source: 'x', width: 400 }), { ok: false, error: 'type inconnu : plantuml' })
  assert.deepEqual(render({ kind: 'dot', source: '  ', width: 400 }), { ok: false, error: 'source DOT manquante' })
  assert.deepEqual(render({ spec: BAR, width: 50 }), { ok: false, error: 'largeur invalide : 50' })
  assert.deepEqual(render({ width: 400 }), { ok: false, error: 'spec manquante ou invalide' })
})
