// Préférences du mod, gardées dans $.store, et la commande /charts qui les change.
import type { Theme } from './render'

export type Prefs = {
  enabled: boolean
  theme: Theme
  /** largeur maximale d'un graphique, en colonnes de terminal */
  maxColumns: number
  /** hauteur maximale d'un graphique, en lignes de terminal */
  maxRows: number
  /** largeur / hauteur d'une cellule du terminal (Ghostty, JetBrains Mono : environ 0,5) */
  cellAspect: number
}

export const DEFAULT_PREFS: Prefs = { enabled: true, theme: 'dark', maxColumns: 100, maxRows: 22, cellAspect: 0.5 }

export const STORE_KEY = 'prefs'

export function prefsFrom(stored: unknown): Prefs {
  if (stored === null || typeof stored !== 'object') return DEFAULT_PREFS
  const merged = { ...DEFAULT_PREFS, ...(stored as Partial<Prefs>) }
  const isValid =
    typeof merged.enabled === 'boolean' &&
    (merged.theme === 'dark' || merged.theme === 'light') &&
    Number.isFinite(merged.maxColumns) &&
    Number.isFinite(merged.maxRows) &&
    Number.isFinite(merged.cellAspect)
  return isValid ? merged : DEFAULT_PREFS
}

export function statusOf(p: Prefs): string {
  return [
    `charts ${p.enabled ? 'on' : 'off'}`,
    `thème ${p.theme}`,
    `largeur max ${p.maxColumns} col`,
    `hauteur max ${p.maxRows} lignes`,
    `ratio cellule ${p.cellAspect}`,
  ].join(' | ')
}

export const USAGE =
  '/charts [on|off] | theme dark|light | width <20-255> | rows <3-80> | cell <0.3-0.8> | reset'

/** Applique les arguments de /charts ; renvoie les nouvelles préférences ou une erreur. */
export function applyCommand(p: Prefs, args: string): { prefs: Prefs } | { error: string } {
  const [word = '', value = ''] = args.trim().toLowerCase().split(/\s+/)
  const n = Number(value.replace(',', '.'))
  switch (word) {
    case '':
    case 'status':
      return { prefs: p }
    case 'on':
      return { prefs: { ...p, enabled: true } }
    case 'off':
      return { prefs: { ...p, enabled: false } }
    case 'reset':
      return { prefs: DEFAULT_PREFS }
    case 'theme':
      return value === 'dark' || value === 'light' ? { prefs: { ...p, theme: value } } : { error: 'thème : dark ou light' }
    case 'width':
      return Number.isInteger(n) && n >= 20 && n <= 255 ? { prefs: { ...p, maxColumns: n } } : { error: 'width : entier de 20 à 255' }
    case 'rows':
      return Number.isInteger(n) && n >= 3 && n <= 80 ? { prefs: { ...p, maxRows: n } } : { error: 'rows : entier de 3 à 80' }
    case 'cell':
      return n >= 0.3 && n <= 0.8 ? { prefs: { ...p, cellAspect: n } } : { error: 'cell : nombre de 0.3 à 0.8' }
    default:
      return { error: `argument inconnu : ${word}. ${USAGE}` }
  }
}

export const GUIDE = [
  '# Charts and diagrams by default',
  'This session draws ```vega-lite (data charts), ```mermaid and ```dot (diagrams) code blocks as real images (terminal and desktop). The person understands a picture faster than prose: show, then tell. Do not wait to be asked for a chart or a diagram.',
  'Add a diagram, unprompted, whenever you explain how something works or is built: architecture, components and their calls, a pipeline or data flow, a request lifecycle, who talks to whom and in what order, a state machine, data models and their relations, a decision flow. Then explain only what the diagram cannot show.',
  'Diagrams: write ```mermaid by default, picking the type that fits: flowchart TD or LR (architecture, pipelines, decisions, subgraph for layers or services), sequenceDiagram (calls in time order between actors), stateDiagram-v2 (lifecycles, statuses), classDiagram (types and their links), erDiagram (tables and relations), gantt (a plan or schedule: sections, tasks with dates as YYYY-MM-DD or YYYY-MM-DD HH:mm, durations like 3d, after id, milestone), pie (a share of a whole, at most 8 slices). No mindmap, timeline or journey. Use ```dot only for a large graph that needs automatic layout with clusters.',
  'Diagram style: short labels (2 to 4 words, <br/> in mermaid or \\n in dot for a second line), edge labels only when they carry information, at most about 20 nodes; split a bigger system into several diagrams. Do not set colors, classDef, style, themes, fonts or init directives: the mod applies its theme. Never use ASCII art for diagrams.',
  'Add a vega-lite block, unprompted, whenever an answer holds any of: two or more comparable quantities (durations, costs, sizes, counts, scores); a trend or anything over time; a before/after; a distribution; a ranking. For a share of a whole write a mermaid pie, for a schedule a mermaid gantt.',
  'Lead with the chart, then one or two sentences: the conclusion and the one or two figures that matter. No table that repeats what the chart shows, no ASCII chart.',
  'Spec: Vega-Lite v6 JSON, data inline in data.values, a short title. Do not set width, height, colors, background or config: the mod applies size and theme. One chart per block, at most 8 series, one y axis; several measures of different units go in separate blocks.',
  'Use measured figures. When a value is an estimate, say so in the title ("estimation") and never present it as measured.',
  'AskUserQuestion: whenever the options differ on something measurable (time, cost, size, risk, effort, perf), give each option a preview holding one vega-lite block of the same shape (same fields, same mark), so the mod lines them up on one shared scale inside the question. Qualitative options can be scored 1 to 5 on two to four criteria, titled as an estimation. When the options are designs, flows or architectures, give each option a preview holding one mermaid diagram of that option instead: the person sees the diagram of the option they look at.',
].join('\n')
