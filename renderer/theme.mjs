// Thème Vega appliqué à toutes les specs : palette catégorielle validée (skill
// dataviz, ordre fixe, jamais recyclé), marques fines, grille discrète, texte
// en encre neutre et jamais dans la couleur d'une série. Même palette pour les
// schémas Graphviz.

// À incrémenter à chaque changement du thème ou du rendu : invalide le cache disque.
export const THEME_VERSION = 8

export const FONT = 'JetBrainsMono Nerd Font, JetBrains Mono, Menlo, monospace'
// Graphviz en wasm ne connaît que les métriques de Times, Helvetica et Courier :
// la mise en page se fait en Courier (chasse fixe 0,6 em, comme JetBrains Mono),
// render.mjs remet FONT dans le SVG avant le rendu.
export const DOT_LAYOUT_FONT = 'Courier'

const RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']

const PALETTES = {
  dark: {
    text: '#c3c2b7',
    title: '#e8e6df',
    muted: '#8a8983',
    grid: '#2f302d',
    domain: '#5a5955',
    category: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    ramp: RAMP,
  },
  light: {
    text: '#52514e',
    title: '#0b0b0b',
    muted: '#7a7975',
    grid: '#e6e5e1',
    domain: '#b5b4ae',
    category: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    ramp: RAMP,
  },
}

const paletteOf = theme => PALETTES[theme] ?? PALETTES.dark

/** Le fond du thème, quand l'image quitte le terminal (« ouvrir en grand »). */
export function backgroundOf(theme) {
  return theme === 'light' ? '#ffffff' : '#16171a'
}

/** Thème beautiful-mermaid : fond transparent, mêmes encres et même accent que les graphiques. */
export function mermaidTheme(theme) {
  const p = paletteOf(theme)
  return {
    bg: backgroundOf(theme),
    fg: p.title,
    accent: p.category[0],
    border: p.category[0],
    line: p.muted,
    muted: p.muted,
    transparent: true,
    // marges et écarts serrés (défauts 40, 24, 40) : un schéma réduit pour tenir en hauteur
    // garde un texte plus grand (flowchart LR de 3 rangs : 250 px de haut, 204 ainsi)
    padding: 8,
    nodeSpacing: 14,
    layerSpacing: 24,
  }
}

/** Attributs par défaut d'un schéma Graphviz ; ceux que la source DOT fixe l'emportent. */
export function dotAttributes(theme) {
  const p = paletteOf(theme)
  return {
    graphAttributes: {
      bgcolor: 'transparent',
      // hérité par les clusters : cadre discret au lieu du noir par défaut
      color: p.domain,
      fontname: DOT_LAYOUT_FONT,
      fontcolor: p.text,
      fontsize: 12,
      pad: 0.2,
      nodesep: 0.4,
      ranksep: 0.5,
    },
    nodeAttributes: {
      shape: 'box',
      style: 'rounded',
      fontname: DOT_LAYOUT_FONT,
      fontsize: 12,
      fontcolor: p.title,
      color: p.category[0],
      penwidth: 1.4,
      margin: '0.18,0.08',
    },
    edgeAttributes: {
      fontname: DOT_LAYOUT_FONT,
      fontsize: 10,
      fontcolor: p.muted,
      color: p.muted,
      arrowsize: 0.7,
    },
  }
}

export function themeConfig(theme) {
  const p = paletteOf(theme)
  return {
    background: null,
    padding: 8,
    font: FONT,
    view: { stroke: null },
    title: { color: p.title, fontSize: 13, fontWeight: 500, anchor: 'start', offset: 10 },
    axis: {
      labelColor: p.text,
      titleColor: p.muted,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 400,
      gridColor: p.grid,
      domainColor: p.domain,
      tickColor: p.domain,
      tickSize: 4,
      tickCount: 6,
      labelPadding: 6,
      labelOverlap: true,
    },
    // sans canvas, vega estime mal la largeur du texte et pivote les labels à 90°
    axisX: { labelAngle: 0, labelOverlap: 'greedy' },
    axisY: { domain: false, ticks: false },
    legend: {
      labelColor: p.text,
      titleColor: p.muted,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 400,
      symbolType: 'square',
      symbolSize: 90,
      orient: 'top',
      direction: 'horizontal',
    },
    header: { labelColor: p.text, titleColor: p.muted, labelFontSize: 11 },
    range: { category: p.category, ramp: p.ramp, heatmap: p.ramp },
    // une marque sans encodage de couleur prend le premier slot, pas le bleu de vega
    mark: { color: p.category[0] },
    bar: { cornerRadiusEnd: 4, discreteBandSize: { band: 0.7 } },
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
    point: { size: 64, filled: true },
    area: { opacity: 0.85 },
    rule: { color: p.muted },
    text: { color: p.text, fontSize: 11 },
  }
}
