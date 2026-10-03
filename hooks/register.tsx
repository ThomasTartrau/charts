// charts : les blocs ```vega-lite (graphiques), ```mermaid et ```dot (schémas) des réponses,
// et les aperçus des options AskUserQuestion (posées dans la bande au-dessus du
// prompt), sont dessinés en vraies images (PNG via le protocole d'image de
// Ghostty, SVG sur le desktop). Le message stocké garde la source : le modèle
// voit toujours les données.
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import {
  answerFreely,
  askedOf,
  confirm,
  hasDrawings,
  isOnOther,
  isSafeId,
  linesOf,
  outcomeOf,
  pressOption,
  questionsOf,
  showOption,
  showOther,
  startAsk,
  withoutPreviewCharts,
  type Asked,
  type AskState,
  type Outcome,
  type Question,
  type Step,
} from './ask'
import { combinedSpec } from './compare'
import { altOf, drawingOf, type Drawn } from './drawings'
import { chartBlocksOf, parseSpec, segmentsOf } from './fences'
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
/** hauteur max des aperçus AskUserQuestion : le moteur refuse 12 lignes ou plus autour du dialogue */
const ASK_ROWS = 10
/** hauteur max d'un schéma, en multiple de la hauteur max d'un graphique */
const DIAGRAM_ROWS_FACTOR = 2
/** largeur max de la colonne des options, dans la bande au-dessus du prompt */
const OPTIONS_COLUMNS = 44
/**
 * Un hook n'a que 10 s de temps propre, mais un appel `$` en cours ne compte pas :
 * l'appel attend la réponse dans un `sh` qui sort quand la bande écrit son fichier.
 */
const WAITER = ['/bin/sh', '-c', 'while [ ! -f "$1" ]; do sleep 0.1; done; cat "$1"; rm -f "$1"', 'charts-ask']
const WAIT_MS = 600_000
/** relances du `sh` avant de rendre la main au dialogue du moteur (30 x 10 min) */
const WAIT_TRIES = 30

let prefs: Prefs = DEFAULT_PREFS
/**
 * Aperçus graphiques d'un AskUserQuestion en cours, par tool_use_id. Le dialogue
 * ne prend pas la réécriture de ses props au rendu : on la fait dans tool.call,
 * et le rendu retrouve ici les specs que les props n'ont plus.
 */
const pendingAsks = new Map<string, Asked>()
/** La question posée dans la bande, une à la fois ; `file` est celui qu'attend le `sh`. */
let activeAsk: { file: string; state: AskState; isDone: boolean } | null = null
/** l'instance de la bande au-dessus du prompt, vue au dernier rendu */
let bandId: string | null = null
/** la bande a le clavier : les flèches marchent, inutile d'indiquer ctrl+x tab */
let bandHasKeys = false
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
  e: RenderInput<'AssistantMessage'> | RenderInput<'AskUserQuestion'> | RenderInput<'AbovePrompt'>,
  drawn: Drawn,
  source: string,
  columns: number,
  maxRows: number,
  /** dans une réponse, l'adresse du bouton « ouvrir en grand » ; absente, rendu compact (dialogue, bande) */
  openKey?: string,
): Promise<RenderElement> {
  const t = $.ui.resolve(e)
  const isCompact = openKey === undefined
  const error = (reason: string) => (
    <t.Text color="red" dimColor wrap={isCompact ? 'truncate' : 'wrap'}>
      {`charts : ${reason}`}
    </t.Text>
  )
  // compact (au-dessus d'un dialogue, 12 lignes au plus) : l'erreur seule, sans la source
  const fallback = (reason: string) =>
    isCompact ? error(reason) : (
      <t.Box flexDirection="column">
        <t.Markdown text={'```\n' + source + '\n```'} />
        {error(reason)}
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
  const withOpen = (image: RenderElement) =>
    openKey === undefined ? image : (
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


/** Attend ce que le panneau écrit ; un `sh` qui ne démarre pas rend la main au dialogue du moteur. */
async function outcomeFrom($: EngineInterface, file: string, signal: AbortSignal): Promise<Outcome> {
  for (let tries = 0; tries < WAIT_TRIES; tries++) {
    // tour interrompu : les appels `$` de ce hook sont rejetés, inutile de relancer
    if (signal.aborted) return { cancel: true }
    // le délai passé sans réponse rejette : on relance l'attente
    const waited = await $.process.run([...WAITER, file], { timeoutMs: WAIT_MS }).then(
      run => outcomeOf(run.stdout) ?? { classic: true as const },
      () => null,
    )
    if (waited) return waited
  }
  return { classic: true }
}

/** Écrit l'issue de la question, une seule fois : le `sh` qui l'attend sort. */
function finishAsk($: EngineInterface, outcome: Outcome) {
  if (!activeAsk || activeAsk.isDone) return
  activeAsk.isDone = true
  // la bande se retire tout de suite, sans attendre que le `sh` sorte
  $.ui.invalidate('ui.render')
  $.fs.write(activeAsk.file, JSON.stringify(outcome)).catch(err => $.ui.log(`charts : réponse non transmise : ${err}`))
}

/** Une option, « Valider » ou « Autre » : la question avance, ou les réponses partent. */
function stepAsk($: EngineInterface, change: (state: AskState) => Step) {
  if (!activeAsk || activeAsk.isDone) return
  const step = change(activeAsk.state)
  if ('answers' in step) return finishAsk($, step)
  activeAsk.state = step.state
  $.ui.invalidate('ui.render')
}

/** Taille de l'image ouverte en grand quand la bande assemble les options en un graphique. */
const LARGE_COMBINED = { width: 1400, height: 700 }

/**
 * L'aperçu de l'option affichée : son texte et ses graphiques ou schémas, à la taille donnée,
 * et ce que « ouvrir en grand » dessine (le premier, ou le graphique assemblé).
 */
async function askPreview(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt'>,
  question: Question,
  focus: number,
  columns: number,
  rows: number,
): Promise<{ element: RenderElement; large: Drawing | null }> {
  const t = $.ui.resolve(e)
  // que des graphiques vega-lite : une seule image, toutes les options sur les mêmes échelles
  const charts = question.options.flatMap((o, i) => {
    const blocks = o.preview ? chartBlocksOf(o.preview) : []
    const parsed = blocks.length === 1 && blocks[0]!.kind === 'vega-lite' ? parseSpec(blocks[0]!.source) : null
    return parsed && 'spec' in parsed ? [{ index: i + 1, label: o.label, spec: parsed.spec }] : []
  })
  if (charts.length >= 2 && charts.length === question.options.filter(o => o.preview).length) {
    const spec = combinedSpec(charts, columns * PX_PER_COLUMN, maxHeightFor(rows, prefs.cellAspect))
    return {
      element: await chartElement($, e, { kind: 'vega-lite', spec }, '', columns, rows),
      large: { kind: 'vega-lite', spec: combinedSpec(charts, LARGE_COMBINED.width, LARGE_COMBINED.height) },
    }
  }

  const preview = question.options[focus]?.preview
  if (!preview) return { element: <t.Text dimColor>(pas d'aperçu pour cette option)</t.Text>, large: null }
  const segments = segmentsOf(preview, chartBlocksOf(preview))
  const large = segments.flatMap(s => (s.kind === 'chart' ? [drawingOf(s.block)] : [])).find((d): d is Drawing => !('error' in d)) ?? null
  // le texte de l'aperçu d'abord : les images se partagent les lignes qui restent
  const textRows = segments.reduce((sum, s) => sum + (s.kind === 'text' ? linesOf(s.text, columns) : 0), 0)
  const imageCount = segments.filter(s => s.kind === 'chart').length
  const imageRows = Math.max(3, Math.floor((rows - textRows) / Math.max(1, imageCount)))
  const parts = await Promise.all(
    segments.map(segment =>
      segment.kind === 'text'
        ? <t.Markdown text={segment.text} />
        : chartElement($, e, drawingOf(segment.block), segment.block.source, columns, imageRows),
    ),
  )
  return { element: <t.Box flexDirection="column">{parts}</t.Box>, large }
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

  // Phase 1, au streaming : la source d'un graphique ne défile pas, une ligne tient sa
  // place jusqu'à l'image (le bloc fini, plus bas).
  on('classic.MessageDisplay', async ($, e, next) => {
    const shown = await next(e)
    if (!prefs.enabled) return shown
    const state = streaming?.messageId === e.message_id ? streaming.state : START
    const display = displayOf(state, shown.displayContent ?? e.delta)
    streaming = e.final ? null : { messageId: e.message_id, state: display.state }
    return { ...shown, displayContent: display.text }
  })

  // Phase 1 : graphiques et schémas dans les réponses, à la place de leur bloc.
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

  // Phase 2 : un aperçu qui se dessine fait poser la question dans la bande
  // au-dessus du prompt, là où s'ouvre le dialogue, l'image à côté des options.
  // Le dialogue du moteur reste le repli.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = questionsOf(e.questions)
    const id = e.tool_use_id
    if (!prefs.enabled || !questions || !id || !hasDrawings(questions)) return next(e)

    // le dialogue du moteur : aperçus sans JSON, graphiques au-dessus
    const classic = () => {
      const asked = askedOf(questions)
      if (!asked) return next(e)
      pendingAsks.set(id, asked)
      return next({ ...e, questions: withoutPreviewCharts(questions) }).finally(() => pendingAsks.delete(id))
    }
    // la bande n'existe que sur le terminal et le desktop ; une question à la fois
    // surfaces illisibles : pas de bande sûre, le dialogue du moteur
    const surfaces = await $.session.surfaces().catch(() => [])
    const hasBand = surfaces.some(s => s === 'terminal' || s === 'desktop')
    const home = await $.env.get('HOME')
    if (activeAsk || !hasBand || !home || !isSafeId(id)) return classic()

    const file = `${home}/.cache/claude-charts/asks/${id}.json`
    activeAsk = { file, state: startAsk(questions), isDone: false }
    bandHasKeys = false
    // le tour interrompu (Échap au prompt, ctrl+c) libère l'attente
    next.signal.addEventListener('abort', () => finishAsk($, { cancel: true }), { once: true })
    $.ui.invalidate('ui.render')
    // le moteur ne donne le clavier à la bande qu'après ctrl+x tab ou un clic : on tente, il peut refuser
    if (bandId) {
      const focused = await $.ui.focus({ requestId: bandId, key: 'option-1' }).catch(err => ({ deny: String(err) }))
      if (focused.deny) $.ui.log(`charts : focus de la bande refusé : ${focused.deny}`, { to: 'debug' })
      else bandHasKeys = true
    }

    const outcome = await outcomeFrom($, file, next.signal).finally(() => {
      activeAsk = null
      $.ui.invalidate('ui.render')
    })
    if ('classic' in outcome) return classic()
    if ('cancel' in outcome) return { deny: "L'utilisateur a annulé la question sans répondre." }
    return { result: { questions, answers: outcome.answers } }
  })

  // Les flèches posent le focus sur une option : son aperçu s'affiche.
  on('ui.focus', async ($, e, next) => {
    const moved = await next(e)
    if (!activeAsk || activeAsk.isDone || e.component !== 'AbovePrompt' || moved.deny) return moved
    if (e.plugin !== undefined && e.plugin !== $.plugin.name) return moved
    bandHasKeys = true
    const option = /^option-(\d+)$/.exec(e.element ?? '')
    const state = activeAsk.state
    const shown = option ? showOption(state, Number(option[1]) - 1) : e.element === 'autre' ? showOther(state) : state
    if (shown !== activeAsk.state) {
      activeAsk.state = shown
      $.ui.invalidate('ui.render')
    }
    return moved
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    bandId = e.requestId
    const state = activeAsk?.state
    const question = state?.questions[state.index]
    if (!state || !question || activeAsk?.isDone || e.props.hasSurvey) return next(e)

    const t = $.ui.resolve(e)
    const count = state.questions.length
    const width = e.props.bodyColumns
    const title = `${question.header}  ${question.question}${count > 1 ? `  (${state.index + 1}/${count})` : ''}`
    const head = (
      <t.Box flexDirection="row" gap={1}>
        <t.Text inverse bold>{` ${question.header} `}</t.Text>
        <t.Text bold wrap="wrap">{question.question}</t.Text>
        {count > 1 ? <t.Text dimColor>{`(${state.index + 1}/${count})`}</t.Text> : null}
      </t.Box>
    )
    // Toutes les options d'un coup, une ligne chacune, à gauche ; la description
    // entière de l'option sous le focus et son aperçu à droite.
    const options = question.options.map((option, i) => {
      const isShown = i === state.focus
      const mark = question.multiSelect ? (state.picked.includes(i) ? '[x]' : '[ ]') : isShown ? '>' : ' '
      return (
        <t.Box flexDirection="row" gap={1}>
          <t.Text color="cyan" bold>{mark}</t.Text>
          <t.Button key={`option-${i + 1}`} plain hotkey={String(i + 1)} autoFocus={i === 0 ? true : undefined} onPress={() => stepAsk($, s => pressOption(s, i))}>
            {option.label}
          </t.Button>
        </t.Box>
      )
    })
    const onOther = isOnOther(state)
    const description = onOther ? 'Tape ta réponse puis Entrée.' : (question.options[state.focus]?.description ?? '')
    // la réponse libre (« Other » du dialogue), là où la surface a un champ de saisie
    const other =
      'Input' in t ? (
        <t.Input key="autre" label="Autre" placeholder="réponse libre" submitLabel="envoyer" onSubmit={(text: string) => stepAsk($, s => answerFreely(s, text))} />
      ) : null
    const choose = question.multiSelect ? 'Entrée : cocher' : 'Entrée : choisir'
    // bas depuis le prompt vient de global/keybindings.json ; ctrl+x tab est celui du moteur
    const keys = bandHasKeys
      ? `haut/bas : voir l'option  ${choose}  Échap : annuler`
      : `bas (ou ctrl+x tab) : aller aux options  chiffre : voir, deux fois : choisir`

    // la colonne des options à la largeur du plus long libellé (marque, « 1: », libellé),
    // ou du champ Autre avec le focus, qui ajoute « ⏎ envoyer » (mesuré en session)
    const longest = Math.max(...question.options.map(o => [...o.label].length + 7), 'Autre: réponse libre ⏎ envoyer'.length + 2)
    const left = Math.min(OPTIONS_COLUMNS, Math.floor(width * 0.4), longest)
    const right = Math.max(20, width - left - 2)
    // Tout doit tenir dans maxRows : titre, écart, corps, pied. Le corps fait la
    // hauteur des options ou de la description et de l'aperçu, ce qui est le plus haut.
    const bodyRows = Math.max(question.options.length + 1, e.props.maxRows - linesOf(title, width) - 2)
    // La description est repliée en entier, jamais coupée. Une image dans l'aperçu : pas de
    // ligne vide sous elle, pour laisser à l'image les quelques lignes que la bande a.
    const shownPreview = onOther ? undefined : question.options[state.focus]?.preview
    const isDrawn = shownPreview !== undefined && chartBlocksOf(shownPreview).length > 0
    const descriptionRows = !description ? 0 : linesOf(description, right) + (isDrawn ? 0 : 1)
    // sur « Autre », pas d'aperçu : celui de la dernière option vue tromperait
    const preview = onOther ? null : await askPreview($, e, question, state.focus, right, bodyRows - descriptionRows)
    const large = preview?.large
    const footer = (
      <t.Box flexDirection="row" gap={2}>
        {question.multiSelect ? (
          <t.Button key="valider" variant="primary" onPress={() => stepAsk($, confirm)}>
            Valider
          </t.Button>
        ) : null}
        <t.Button key="annuler" dimColor onPress={() => finishAsk($, { cancel: true })}>
          Annuler
        </t.Button>
        {large ? (
          <t.Button key="ouvrir" plain dimColor onPress={() => openLarge($, large)}>
            ouvrir en grand
          </t.Button>
        ) : null}
        <t.Text dimColor wrap="truncate">{keys}</t.Text>
      </t.Box>
    )
    return (
      <t.Box flexDirection="column">
        {head}
        <t.Box flexDirection="row" gap={2} marginTop={1}>
          <t.Box flexDirection="column" width={left}>
            {options}
            {other}
          </t.Box>
          <t.Box flexDirection="column" width={right}>
            {description ? <t.Text dimColor wrap="wrap">{description}</t.Text> : null}
            {description && !isDrawn ? <t.Text> </t.Text> : null}
            {preview?.element}
          </t.Box>
        </t.Box>
        {footer}
      </t.Box>
    )
  })

  // Phase 2, au rendu : une image au-dessus de la boîte de dialogue.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (!prefs.enabled) return next(e)
    const questions = questionsOf(e.props.questions)
    if (!questions) return next(e)
    const asked = pendingAsks.get(e.requestId) ?? askedOf(questions)
    if (!asked) return next(e)

    // sans effet quand tool.call a déjà réécrit ; utile si le dialogue vient d'ailleurs
    const dialog = await next({ ...e, props: { ...e.props, questions: withoutPreviewCharts(questions) } })

    // Le moteur n'accepte que 12 lignes autour du dialogue (il additionne les
    // enfants d'une rangée) et rien en dessous : une seule image au-dessus, qui
    // assemble les options sur des échelles partagées.
    const valid = asked.charts.flatMap(item => {
      const parsed = parseSpec(item.block.source)
      return 'spec' in parsed ? [{ index: item.index, label: item.label, spec: parsed.spec }] : []
    })
    const broken = asked.charts.filter(item => !valid.some(v => v.index === item.index)).map(item => item.index)

    const t = $.ui.resolve(e)
    const columns = chartColumns(e.viewport?.columns, Math.max(prefs.maxColumns, 120), INDENT)
    // mesuré avec claude plugin test : la ligne d'erreur en plus coûte 2 lignes à l'image
    const rows = broken.length > 0 ? ASK_ROWS - 2 : ASK_ROWS
    const parts: RenderElement[] = []
    if (valid.length > 0) {
      const spec = combinedSpec(valid, columns * PX_PER_COLUMN, maxHeightFor(rows, prefs.cellAspect))
      parts.push(await chartElement($, e, { kind: 'vega-lite', spec }, '', columns, rows))
    }
    if (broken.length > 0) {
      parts.push(
        <t.Text color="red" dimColor wrap="truncate">
          {`charts : aperçu illisible pour l'option ${broken.join(', ')}`}
        </t.Text>,
      )
    }
    return (
      <t.Box flexDirection="column" gap={1}>
        <t.Box flexDirection="column" paddingLeft={INDENT}>
          {parts}
        </t.Box>
        {dialog}
      </t.Box>
    )
  })
}
