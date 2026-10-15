#!/usr/bin/env node
// Rendu d'un graphique Vega-Lite ou d'un schéma (mermaid, Graphviz DOT) en SVG
// ou PNG, pour le mod charts.
//
// Entrée (stdin, JSON) :
//   { kind?: "vega-lite" | "mermaid" | "dot", spec?, peers?, source?, width, maxHeight?, theme, format: "png" | "svg", scale?, opaque? }
//   spec (objet) pour vega-lite, source (texte) pour mermaid et dot ; opaque : PNG sur le fond du thème.
//   peers : les specs des autres options d'une question, dont les axes quantitatifs sont partagés.
// Sortie (stdout, JSON) : { ok: true, file?, svg?, width, height } ou { ok: false, error }
//
// Le PNG est écrit dans ~/.cache/claude-charts/<hash>.png. Un hash déjà rendu
// répond sans charger vega ni graphviz, ce qui garde les redessins quasi gratuits.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveCssVars } from './css-vars.mjs'
import { backgroundOf, DOT_LAYOUT_FONT, dotAttributes, FONT, mermaidTheme, THEME_VERSION, themeConfig } from './theme.mjs'

const DRAWERS = { 'vega-lite': vegaLiteSvg, dot: dotSvg, mermaid: mermaidSvg }

const CACHE_DIR = join(homedir(), '.cache', 'claude-charts')
const COMPOSITE = ['facet', 'hconcat', 'vconcat', 'concat', 'repeat']
const PX_PER_PT = 4 / 3

function reply(value) {
  process.stdout.write(JSON.stringify(value))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function sized(spec, width, maxHeight) {
  const isComposite = COMPOSITE.some(key => key in spec)
  if (isComposite || spec.width !== undefined) return spec
  const natural = Math.max(width * 0.42, 140)
  const height = spec.height ?? Math.round(Math.min(natural, maxHeight ?? 360))
  return {
    ...spec,
    width,
    height,
    autosize: { type: 'fit', contains: 'padding' },
  }
}

function svgSize(svg, unit) {
  const match = svg.match(/<svg[^>]*\swidth="([\d.]+)(pt|px)?"[^>]*\sheight="([\d.]+)(pt|px)?"/)
  if (!match) return null
  return { width: Number(match[1]) * unit, height: Number(match[3]) * unit }
}

/**
 * vega-lite empile les barres même sur un axe log : chaque barre part de 0, log(0)
 * vaut -inf, le domaine devient [0, ...] et plus aucune marque n'est dessinée. Un
 * canal log sans `stack` explicite est désempilé, dans toutes les sous-vues.
 */
function unstackedLog(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return spec
  const out = { ...spec }
  if (spec.encoding && typeof spec.encoding === 'object') {
    out.encoding = { ...spec.encoding }
    for (const channel of ['x', 'y']) {
      const def = spec.encoding[channel]
      if (def?.scale?.type === 'log' && !('stack' in def)) out.encoding[channel] = { ...def, stack: null }
    }
  }
  for (const key of ['layer', 'concat', 'hconcat', 'vconcat']) {
    if (Array.isArray(spec[key])) out[key] = spec[key].map(unstackedLog)
  }
  if (spec.spec) out.spec = unstackedLog(spec.spec)
  return out
}

const QUANTITATIVE_SCALES = new Set(['linear', 'log', 'pow', 'sqrt', 'symlog'])

/**
 * Les domaines x et y communs à toutes les specs : pour chaque axe quantitatif de
 * même type partout, du plus petit au plus grand des domaines calculés par vega.
 * Un axe absent, d'un autre type ou une spec qui ne compile pas : pas de partage.
 */
async function sharedDomains(vega, vegaLite, specs, theme) {
  const found = { x: [], y: [] }
  for (const spec of specs) {
    let view
    try {
      view = new vega.View(vega.parse(vegaLite.compile(spec, { config: themeConfig(theme) }).spec), { renderer: 'none' })
      await view.runAsync()
    } catch {
      return {}
    }
    for (const channel of ['x', 'y']) {
      let scale
      try {
        scale = view.scale(channel)
      } catch {
        // pas d'échelle de ce nom dans cette vue
      }
      const domain = scale?.domain()
      found[channel].push(QUANTITATIVE_SCALES.has(scale?.type) && domain?.every(Number.isFinite) ? { type: scale.type, domain } : null)
    }
    view.finalize()
  }
  const domains = {}
  for (const channel of ['x', 'y']) {
    const all = found[channel]
    if (all.some(d => d === null) || new Set(all.map(d => d.type)).size !== 1) continue
    domains[channel] = [Math.min(...all.map(d => d.domain[0])), Math.max(...all.map(d => d.domain.at(-1)))]
  }
  return domains
}

/** Impose les domaines partagés à chaque encodage de l'axe, au sommet et dans les calques. */
function withDomains(spec, domains) {
  const out = { ...spec }
  if (spec.encoding && typeof spec.encoding === 'object') {
    out.encoding = { ...spec.encoding }
    for (const [channel, domain] of Object.entries(domains)) {
      const def = spec.encoding[channel]
      if (def && typeof def === 'object') out.encoding[channel] = { ...def, scale: { ...def.scale, domain, nice: false } }
    }
  }
  if (Array.isArray(spec.layer)) out.layer = spec.layer.map(layer => withDomains(layer, domains))
  return out
}

/** vega-lite : la taille est imposée à la compilation, l'échelle de sortie vaut 1. */
async function vegaLiteSvg(spec, width, maxHeight, theme, peers) {
  if (!spec || typeof spec !== 'object') throw new Error('spec manquante ou invalide')
  const [vega, vegaLite] = await Promise.all([import('vega'), import('vega-lite')])
  const prepared = (s) => sized(unstackedLog(s), width, maxHeight)
  let drawn = prepared(spec)
  const others = Array.isArray(peers) ? peers.filter(p => p && typeof p === 'object' && !Array.isArray(p)) : []
  if (others.length > 0) drawn = withDomains(drawn, await sharedDomains(vega, vegaLite, [drawn, ...others.map(prepared)], theme))
  let compiled
  try {
    compiled = vegaLite.compile(drawn, { config: themeConfig(theme) }).spec
  } catch (error) {
    // vega-lite donne parfois une erreur interne (mark inconnue) : on dit d'où elle vient
    throw new Error(`spec vega-lite invalide : ${messageOf(error)}`)
  }
  const view = new vega.View(vega.parse(compiled), { renderer: 'none' })
  const svg = await view.toSVG()
  view.finalize()
  const size = svgSize(svg, 1) ?? { width, height: width / 2 }
  return { svg, size, fit: 1 }
}

/** Réduit un schéma pour tenir dans la boîte ; jamais agrandi au-delà de sa taille naturelle. */
function fitted(svg, natural, width, maxHeight) {
  const fit = Math.min(1, width / natural.width, (maxHeight ?? Infinity) / natural.height)
  return { svg, size: { width: Math.round(natural.width * fit), height: Math.round(natural.height * fit) }, fit }
}

/** L'autre sens de lecture : LR devient TB et inversement (TB est le défaut de graphviz). */
function flipped(source) {
  const rankdir = /rankdir\s*=\s*"?(LR|RL|TB|BT)"?/i
  const match = rankdir.exec(source)
  if (!match) return { source, graphAttributes: { rankdir: 'LR' } }
  const next = /^(LR|RL)$/i.test(match[1]) ? 'TB' : 'LR'
  return { source: source.replace(rankdir, `rankdir=${next}`), graphAttributes: {} }
}

/**
 * dot : graphviz décide de la taille. Si le schéma doit être trop réduit pour
 * tenir, on le trace dans l'autre sens et on garde la version la moins réduite.
 */
async function dotSvg(source, width, maxHeight, theme) {
  if (typeof source !== 'string' || source.trim() === '') throw new Error('source DOT manquante')
  const { instance } = await import('@viz-js/viz')
  const viz = await instance()
  const attributes = dotAttributes(theme)
  const layout = (src, extra) => {
    const raw = viz.renderString(src, {
      format: 'svg',
      ...attributes,
      graphAttributes: { ...attributes.graphAttributes, ...extra },
    })
    // le desktop attend un document qui commence par <svg ; la police de mise en page est remplacée
    const svg = raw.slice(raw.indexOf('<svg')).replaceAll(`font-family="${DOT_LAYOUT_FONT}`, `font-family="${FONT}`)
    const natural = svgSize(svg, PX_PER_PT)
    if (!natural) throw new Error('graphviz a rendu un SVG sans taille')
    return fitted(svg, natural, width, maxHeight)
  }
  let first
  try {
    first = layout(source, {})
  } catch (error) {
    throw new Error(`DOT invalide : ${messageOf(error)}`)
  }
  if (first.fit >= 0.85) return first
  const other = flipped(source)
  const second = layout(other.source, other.graphAttributes)
  return second.fit > first.fit ? second : first
}

/** mermaid : beautiful-mermaid, sans DOM ; ses variables CSS sont résolues pour resvg. */
async function mermaidSvg(source, width, maxHeight, theme) {
  if (typeof source !== 'string' || source.trim() === '') throw new Error('source mermaid manquante')
  const { renderMermaidSVG } = await import('beautiful-mermaid')
  let raw
  try {
    raw = renderMermaidSVG(source, mermaidTheme(theme))
  } catch (error) {
    throw new Error(`mermaid invalide ou type non pris en charge : ${messageOf(error)}`)
  }
  const svg = resolveCssVars(raw)
  const natural = svgSize(svg, 1)
  if (!natural) throw new Error('mermaid a rendu un SVG sans taille')
  return fitted(svg, natural, width, maxHeight)
}

async function render(input) {
  const { kind = 'vega-lite', spec, peers, source, width, maxHeight, theme = 'dark', format = 'png', scale = 2, opaque = false } = input
  if (!(kind in DRAWERS)) throw new Error(`type inconnu : ${kind}`)
  if (!Number.isFinite(width) || width < 120) throw new Error(`largeur invalide : ${width}`)

  // opaque absent du hash quand il est faux : le cache déjà rendu reste valable
  const key = createHash('sha256')
    .update(JSON.stringify({ kind, spec, peers, source, width, maxHeight, theme, format, scale, opaque: opaque || undefined, v: THEME_VERSION }))
    .digest('hex')
    .slice(0, 24)
  const file = join(CACHE_DIR, `${key}.${format}`)
  const meta = join(CACHE_DIR, `${key}.json`)

  if (existsSync(file) && existsSync(meta)) {
    const cached = JSON.parse(readFileSync(meta, 'utf8'))
    return format === 'svg' ? { ok: true, svg: readFileSync(file, 'utf8'), ...cached } : { ok: true, file, ...cached }
  }

  const { svg, size, fit } = await DRAWERS[kind](kind === 'vega-lite' ? spec : source, width, maxHeight, theme, peers)

  mkdirSync(CACHE_DIR, { recursive: true })
  if (format === 'svg') {
    writeFileSync(file, svg)
  } else {
    const { Resvg } = await import('@resvg/resvg-js')
    const png = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale * fit },
      ...(opaque ? { background: backgroundOf(theme) } : {}),
      // mermaid demande Inter puis sans-serif : Helvetica Neue a des métriques proches
      font: { loadSystemFonts: true, defaultFontFamily: 'JetBrains Mono', sansSerifFamily: 'Helvetica Neue' },
    })
      .render()
      .asPng()
    writeFileSync(file, png)
  }
  writeFileSync(meta, JSON.stringify(size))

  return format === 'svg' ? { ok: true, svg, ...size } : { ok: true, file, ...size }
}

try {
  reply(await render(JSON.parse(readFileSync(0, 'utf8'))))
} catch (error) {
  reply({ ok: false, error: messageOf(error) })
}
