// Ce qu'un bloc devient pour le renderer, et le texte alternatif de son image.
import { parseSpec, type ChartBlock } from './fences'
import { mermaidChart } from './mermaid-charts'
import type { Drawing } from './render'

export type Drawn = Drawing | { error: string }

/** Un bloc à dessiner ; un camembert ou un gantt mermaid devient un graphique vega-lite. */
export function drawingOf(block: ChartBlock): Drawn {
  if (block.kind === 'vega-lite') {
    const parsed = parseSpec(block.source)
    return 'spec' in parsed ? { kind: 'vega-lite', spec: parsed.spec } : parsed
  }
  const chart = block.kind === 'mermaid' ? mermaidChart(block.source) : null
  if (chart) return 'spec' in chart ? { kind: 'vega-lite', spec: chart.spec } : chart
  return { kind: block.kind, source: block.source }
}

export function altOf(drawing: Drawing): string {
  if (drawing.kind !== 'vega-lite') {
    // mermaid : le type en tête (sequenceDiagram) ; dot : le nom du graphe
    const name =
      drawing.kind === 'mermaid'
        ? drawing.source.trim().split(/\s/)[0]
        : /^\s*(?:strict\s+)?(?:di)?graph\s+"?([^\s{"]+)/i.exec(drawing.source)?.[1]
    return name ? `schéma ${name}` : 'schéma'
  }
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const { title, description } = drawing.spec
  const titleText = typeof title === 'object' && title !== null ? Reflect.get(title, 'text') : title
  return pick(description) ?? pick(titleText) ?? 'graphique vega-lite'
}
