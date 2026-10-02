// Repérage des blocs ```vega-lite, ```mermaid et ```dot fermés dans un texte markdown, et
// découpage du texte en segments texte / graphique, dans l'ordre.

export type BlockKind = 'vega-lite' | 'mermaid' | 'dot'

export type ChartBlock = {
  /** graphique de données (vega-lite) ou schéma (mermaid, Graphviz DOT) */
  kind: BlockKind
  /** début du bloc entier, ligne d'ouverture comprise */
  start: number
  /** fin du bloc entier, ligne de fermeture comprise */
  end: number
  /** le contenu entre les deux lignes de fence : JSON vega-lite ou texte DOT */
  source: string
}

export type Segment = { kind: 'text'; text: string } | { kind: 'chart'; block: ChartBlock }

export type ParsedSpec = { spec: Record<string, unknown> } | { error: string }

const LANGS = new Map<string, BlockKind>([
  ['vega-lite', 'vega-lite'],
  ['vegalite', 'vega-lite'],
  ['vl', 'vega-lite'],
  ['mermaid', 'mermaid'],
  ['dot', 'dot'],
  ['graphviz', 'dot'],
])

// Ouverture : indentation, 3+ backticks ou tildes, info string. La fermeture
// doit utiliser le même caractère, au moins aussi long, seule sur sa ligne.
const OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/

export function chartBlocksOf(text: string): ChartBlock[] {
  const blocks: ChartBlock[] = []
  const lines = text.split('\n')
  let offset = 0
  let open: { start: number; fence: string; kind: BlockKind | undefined; bodyStart: number } | null = null

  for (const line of lines) {
    const lineEnd = offset + line.length
    if (open === null) {
      const match = OPEN.exec(line)
      if (match) {
        const fence = match[2] ?? '```'
        const lang = (match[3] ?? '').toLowerCase()
        open = { start: offset, fence, kind: LANGS.get(lang), bodyStart: lineEnd + 1 }
      }
    } else {
      const trimmed = line.trim()
      const isClose =
        trimmed.length >= open.fence.length &&
        trimmed[0] === open.fence[0] &&
        [...trimmed].every(c => c === open!.fence[0])
      if (isClose) {
        if (open.kind) {
          const source = text.slice(open.bodyStart, Math.max(open.bodyStart, offset - 1)).trim()
          if (source.length > 0) blocks.push({ kind: open.kind, start: open.start, end: lineEnd, source })
        }
        open = null
      }
    }
    offset = lineEnd + 1
  }
  // un bloc encore ouvert (réponse en streaming) n'est pas un graphique
  return blocks
}

export function segmentsOf(text: string, blocks: readonly ChartBlock[]): Segment[] {
  const segments: Segment[] = []
  let cursor = 0
  for (const block of blocks) {
    const before = text.slice(cursor, block.start).replace(/\n+$/, '')
    if (before.trim().length > 0) segments.push({ kind: 'text', text: before })
    segments.push({ kind: 'chart', block })
    cursor = block.end
  }
  const after = text.slice(cursor).replace(/^\n+/, '')
  if (after.trim().length > 0) segments.push({ kind: 'text', text: after })
  return segments
}

export function parseSpec(source: string): ParsedSpec {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { error: `JSON invalide : ${error instanceof Error ? error.message : String(error)}` }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'la spec doit être un objet JSON' }
  }
  return { spec: value as Record<string, unknown> }
}

/** Remplace chaque bloc vega-lite par une courte mention, pour un aperçu texte ; un schéma reste. */
export function withoutCharts(text: string, label: string): string {
  const blocks = chartBlocksOf(text).filter(block => block.kind === 'vega-lite')
  if (blocks.length === 0) return text
  let out = ''
  let cursor = 0
  for (const block of blocks) {
    out += text.slice(cursor, block.start) + label
    cursor = block.end
  }
  return out + text.slice(cursor)
}
