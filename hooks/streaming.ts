// Pendant le streaming, le moteur ne dessine un bloc de texte qu'une fois ce bloc
// terminé : un graphique n'apparaît qu'à la fin de la réponse, et sa source défile
// en attendant. Le texte qui défile cache donc la source d'un graphique ou d'un
// schéma et la remplace, à la fence fermante, par une ligne qui dit où il viendra.

import { chartBlocksOf, closesFence, fenceOpening, parseSpec, type BlockKind } from './fences'

export type StreamState = {
  /** le bloc de code ouvert dans le texte déjà vu ; `kind` absent pour un code ordinaire, laissé visible */
  open: { fence: string; kind: BlockKind | undefined; body: string[] } | null
}

export const START: StreamState = { open: null }

/** Le titre d'une spec vega-lite, quand elle en a un lisible. */
function titleOf(source: string): string | undefined {
  const parsed = parseSpec(source)
  if (!('spec' in parsed)) return undefined
  const title = parsed.spec.title
  const text = typeof title === 'object' && title !== null && !Array.isArray(title) ? (title as { text?: unknown }).text : title
  const line = Array.isArray(text) ? text.join(' ') : text
  return typeof line === 'string' && line.trim() ? line.trim() : undefined
}

/** La ligne qui tient la place d'un bloc fermé jusqu'à son image. */
export function placeholderOf(kind: BlockKind, source: string): string {
  if (kind !== 'vega-lite') return `*Schéma ${kind} : dessiné à la fin de la réponse*`
  const title = titleOf(source)
  return title ? `*Graphique "${title}" : dessiné à la fin de la réponse*` : '*Graphique : dessiné à la fin de la réponse*'
}

/** Le texte à afficher pour un lot de lignes reçues, et l'état pour le lot suivant. */
export function displayOf(state: StreamState, delta: string): { state: StreamState; text: string } {
  let open = state.open
  const shown: string[] = []
  // le dernier élément est vide quand le lot finit sur un saut de ligne : il ne se rejoint pas
  const lines = delta.split('\n')
  const isWhole = delta.endsWith('\n')
  for (const [i, line] of lines.entries()) {
    if (isWhole && i === lines.length - 1) break
    if (open === null) {
      const opening = fenceOpening(line)
      if (opening) open = { ...opening, body: [] }
      if (!opening?.kind) shown.push(line)
    } else if (closesFence(line, open.fence)) {
      shown.push(open.kind ? placeholderOf(open.kind, open.body.join('\n')) : line)
      open = null
    } else {
      if (open.kind) open = { ...open, body: [...open.body, line] }
      else shown.push(line)
    }
  }
  const text = shown.length === 0 ? '' : shown.join('\n') + (isWhole ? '\n' : '')
  return { state: { open }, text }
}

// « Graphique : ... » sans titre, « Graphique "Titre" : ... » avec
const PLACEHOLDER = /^\*(?:Graphique|Schéma)(?: .*)? : dessiné à la fin de la réponse\*$/m

/** Le texte vient du streaming : une ligne y tient la place d'un graphique. */
export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text)
}

const squeezed = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Le moteur garde le texte affiché au streaming pour dessiner le bloc fini : on
 * remet la source à la place de chaque ligne de remplacement, prise dans le
 * message enregistré (`stored`, du plus ancien au plus récent) qui a donné ce
 * texte. null quand aucun ne l'a donné.
 */
export function restoredFrom(shown: string, stored: readonly string[]): string | null {
  for (const original of stored.toReversed()) {
    // ce message, transformé, contient le texte affiché : c'est le bon, même joint à d'autres blocs
    if (!squeezed(displayOf(START, original).text).includes(squeezed(shown))) continue
    const blocks = chartBlocksOf(original).map(block => ({
      placeholder: placeholderOf(block.kind, block.source),
      fenced: original.slice(block.start, block.end),
    }))
    let next = 0
    const lines = shown.split('\n').map(line => {
      if (!PLACEHOLDER.test(line)) return line
      const at = blocks.findIndex((block, i) => i >= next && block.placeholder === line)
      if (at < 0) return line
      next = at + 1
      return blocks[at]!.fenced
    })
    if (next > 0) return lines.join('\n')
  }
  return null
}
