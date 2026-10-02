// Les graphiques des options d'une question AskUserQuestion, assemblés en une
// seule spec hconcat : une image, des échelles partagées, donc comparables.

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
