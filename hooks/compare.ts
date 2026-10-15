// Les graphiques des options d'une question AskUserQuestion, comparables : assemblés
// en une seule spec hconcat (dialogue du moteur), ou un par option, dessiné avec les
// specs des autres pour partager ses axes (bande au-dessus du prompt).
import { chartBlocksOf, parseSpec } from './fences'

export type OptionChart = { index: number; label: string; spec: Record<string, unknown> }

/** place prise par l'axe y et ses labels, à gauche de chaque graphique */
const AXIS_ROOM = 56
/** place prise par le titre de l'option et l'axe x */
const CHROME = 58

export function combinedSpec(items: readonly OptionChart[], totalWidth: number, totalHeight: number): Record<string, unknown> {
  const perWidth = Math.max(60, Math.floor(totalWidth / Math.max(1, items.length)) - AXIS_ROOM)
  const perHeight = Math.max(40, totalHeight - CHROME)
  return {
    hconcat: items.map(({ index, label, spec }) => {
      // $schema et config n'ont de sens qu'au sommet ; la taille est imposée
      const { $schema: _schema, config: _config, width: _w, height: _h, title: _t, ...rest } = spec
      return { ...rest, title: `${index}. ${label}`, width: perWidth, height: perHeight }
    }),
    resolve: { scale: { x: 'shared', y: 'shared', color: 'shared' } },
    spacing: 16,
  }
}

/** La spec vega-lite d'un aperçu qui n'a qu'un graphique, et rien d'autre à dessiner ; sinon null. */
function singleSpecOf(preview: string | undefined): Record<string, unknown> | null {
  const blocks = preview ? chartBlocksOf(preview) : []
  if (blocks.length !== 1 || blocks[0]!.kind !== 'vega-lite') return null
  const parsed = parseSpec(blocks[0]!.source)
  return 'spec' in parsed ? parsed.spec : null
}

/**
 * Les specs des autres options, quand l'option `focus` et au moins une autre n'ont
 * qu'un graphique vega-lite : le renderer leur emprunte leurs axes. Sinon, aucune.
 */
export function peersOf(options: readonly { preview?: string }[], focus: number): Record<string, unknown>[] {
  if (!singleSpecOf(options[focus]?.preview)) return []
  return options.flatMap((o, i) => {
    const spec = i === focus ? null : singleSpecOf(o.preview)
    return spec ? [spec] : []
  })
}
