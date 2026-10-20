// charts : les blocs ```vega-lite (graphiques), ```mermaid et ```dot (schémas) des réponses
// sont dessinés en vraies images (PNG via le protocole d'image de Ghostty, SVG sur le
// desktop). Le message stocké garde la source : le modèle voit toujours les données.
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { altOf, drawingOf, type Drawn } from './drawings'
import { chartBlocksOf, segmentsOf } from './fences'
import { applyCommand, DEFAULT_PREFS, GUIDE, prefsFrom, statusOf, STORE_KEY, USAGE, type Prefs } from './prefs'
import {
  chartColumns,
  chartRows,
  clearMemo,
  maxHeightFor,
  openInViewer,
  PX_PER_COLUMN,
  renderChart,
  type Drawing,
  type Run,
} from './render'
import { displayOf, hasPlaceholder, restoredFrom, START, type StreamState } from './streaming'

const COMMAND = 'charts'
/** retrait du texte d'une réponse sous la puce, en colonnes */
const INDENT = 2
/** hauteur max d'un schéma, en multiple de la hauteur max d'un graphique */
const DIAGRAM_ROWS_FACTOR = 2

let prefs: Prefs = DEFAULT_PREFS
/** Le message qui s'écrit : son id, et le bloc de code ouvert dans ce qui en est déjà affiché. */
let streaming: { messageId: string; state: StreamState } | null = null
/** Le texte d'origine des blocs affichés avec une ligne de remplacement, par message : un redessin ne relit pas la session. */
const restored = new Map<string, string>()

/** Rend l'image en grand, fond plein, et l'ouvre dans la visionneuse du système. */
function openLarge($: EngineInterface, drawing: Drawing) {
  const run: Run = (argv, init) => $.process.run(argv, init)
  openInViewer(run, $.plugin.root, drawing, prefs.theme)
    .then(error => error && $.ui.toast(`charts : ouverture impossible : ${error}`))
    .catch(err => $.ui.log(`charts : ouverture impossible : ${err}`))
}

/**
 * Le texte d'un bloc fini avec ses sources : le moteur le dessine avec le texte affiché
 * au streaming, où une ligne tient la place de chaque graphique ; la source est relue
 * dans le message enregistré. Introuvable, le texte reste tel quel.
 */
async function sourceOf($: EngineInterface, requestId: string, text: string): Promise<string> {
  if (!hasPlaceholder(text)) return text
  const known = restored.get(requestId)
  if (known !== undefined) return known
  const messages = await $.session.messages().catch(err => {
    $.ui.log(`charts : messages de la session illisibles : ${err}`)
    return []
  })
  // sans agentId, toujours la liste (jamais de deny pour la conversation principale)
  const replies = Array.isArray(messages) ? messages.filter(m => m.role === 'assistant').map(m => m.text) : []
  const found = restoredFrom(text, replies)
  if (found === null) return text
  restored.set(requestId, found)
  return found
}

/** Un graphique ou un schéma prêt à dessiner, ou l'erreur à montrer sous sa source. */
async function chartElement(
  $: EngineInterface,
  e: RenderInput<'AssistantMessage'>,
  drawn: Drawn,
  source: string,
  columns: number,
  maxRows: number,
  /** l'adresse du bouton « ouvrir en grand » sous l'image */
  openKey: string,
): Promise<RenderElement> {
  const t = $.ui.resolve(e)
  const fallback = (reason: string) => (
    <t.Box flexDirection="column">
      <t.Markdown text={'```\n' + source + '\n```'} />
      <t.Text color="red" dimColor wrap="wrap">
        {`charts : ${reason}`}
      </t.Text>
    </t.Box>
  )
  if ('error' in drawn) return fallback(drawn.error)

  const surface = e.surface
  const run: Run = (argv, init) => $.process.run(argv, init)
  const rendered = await renderChart(run, $.plugin.root, drawn, {
    width: columns * PX_PER_COLUMN,
    maxHeight: maxHeightFor(maxRows, prefs.cellAspect),
    theme: prefs.theme,
    format: surface === 'terminal' ? 'png' : 'svg',
  })
  if (!rendered.ok) return fallback(rendered.error)

  const alt = altOf(drawn)
  const withOpen = (image: RenderElement) => (
    <t.Box flexDirection="column">
      {image}
      <t.Button key={openKey} plain dimColor onPress={() => openLarge($, drawn)}>
        ouvrir en grand
      </t.Button>
    </t.Box>
  )
  if ('Image' in t && rendered.file) {
    // un schéma ou une spec composite peut sortir plus étroit que demandé
    let width = Math.min(columns, Math.ceil(rendered.width / PX_PER_COLUMN))
    const natural = chartRows(width, rendered.width, rendered.height, prefs.cellAspect)
    // plus haute que la place (hauteur fixée par la spec) : réduite en largeur aussi, sinon écrasée
    if (natural > maxRows) width = Math.max(1, Math.round((width * maxRows) / natural))
    const rows = Math.min(maxRows, natural)
    return withOpen(<t.Image source={{ file: rendered.file, format: 'png' }} columns={width} rows={rows} alt={alt} />)
  }
  if ('Svg' in t && rendered.svg) {
    if (rendered.svg.length > 131_072) return fallback('SVG trop lourd pour la surface (plus de 128 Kio)')
    return withOpen(<t.Svg source={rendered.svg} alt={alt} width={rendered.width} />)
  }
  return fallback(`surface ${surface} sans image`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    prefs = prefsFrom(await $.store.get(STORE_KEY).catch(() => undefined))
    await $.command
      .register({
        name: COMMAND,
        description: 'Graphiques vega-lite et schémas dot dessinés en images : on|off, theme, width, rows, cell, reset (charts)',
        argumentHint: '[on|off|theme dark|light|width N|rows N|cell R|reset]',
        immediate: true,
      })
      .catch(err => $.ui.log(`charts : /${COMMAND} non enregistrée : ${err}`))
    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const applied = applyCommand(prefs, e.args)
    if ('error' in applied) return { text: `${applied.error}\n${USAGE}` }
    if (applied.prefs !== prefs) {
      prefs = applied.prefs
      await $.store.set(STORE_KEY, prefs).catch(err => $.ui.log(`charts : écriture du store impossible : ${err}`))
      clearMemo()
      $.ui.invalidate('ui.render')
    }
    return { text: statusOf(prefs) }
  })

  // Le modèle apprend à montrer avant d'écrire : graphiques et schémas par défaut.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!prefs.enabled || e.surfaces.length === 0) return composed
    return { sections: [...composed.sections, { id: 'charts:guide', text: GUIDE, scope: 'session' as const }] }
  })

  // Au streaming : la source d'un graphique ne défile pas, une ligne tient sa place
  // jusqu'à l'image (le bloc fini, plus bas).
  on('classic.MessageDisplay', async ($, e, next) => {
    const shown = await next(e)
    if (!prefs.enabled) return shown
    const state = streaming?.messageId === e.message_id ? streaming.state : START
    const display = displayOf(state, shown.displayContent ?? e.delta)
    streaming = e.final ? null : { messageId: e.message_id, state: display.state }
    return { ...shown, displayContent: display.text }
  })

  // Graphiques et schémas dans les réponses, à la place de leur bloc.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!prefs.enabled) return next(e)
    const text = await sourceOf($, e.requestId, e.props.text)
    if (text !== e.props.text) e = { ...e, props: { ...e.props, text } }
    const blocks = chartBlocksOf(e.props.text)
    if (blocks.length === 0) return next(e)

    const t = $.ui.resolve(e)
    const chartSize = { columns: chartColumns(e.viewport?.columns, prefs.maxColumns, INDENT), rows: prefs.maxRows }
    // un schéma prend toute la largeur et deux fois la hauteur d'un graphique : réduit, il devient illisible
    const diagramSize = { columns: chartColumns(e.viewport?.columns, 255, INDENT), rows: prefs.maxRows * DIAGRAM_ROWS_FACTOR }
    const segments = segmentsOf(e.props.text, blocks)
    const [first, ...rest] = segments

    // Le premier segment texte passe par le moteur, qui garde la puce et le style.
    const lead = first?.kind === 'text' ? first.text : first?.block.kind === 'vega-lite' ? 'Graphique :' : 'Schéma :'
    const children: RenderElement[] = [await next({ ...e, props: { ...e.props, text: lead } })]
    const tail = first?.kind === 'text' ? rest : segments

    // un process node par image : rendus en parallèle
    const bodies = await Promise.all(
      tail.map((segment, i) => {
        if (segment.kind === 'text') return <t.Markdown text={segment.text} />
        const drawn = drawingOf(segment.block)
        // un camembert ou un gantt mermaid est devenu un graphique : taille de graphique
        const size = 'kind' in drawn && drawn.kind !== 'vega-lite' ? diagramSize : chartSize
        return chartElement($, e, drawn, segment.block.source, size.columns, size.rows, `open-${i}`)
      }),
    )
    for (const body of bodies) children.push(<t.Box paddingLeft={INDENT}>{body}</t.Box>)
    return <t.Box flexDirection="column" gap={1}>{children}</t.Box>
  })
}
