import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderInput, RenderSurface } from 'claude-code'

const SPEC = '{"mark":"bar","data":{"values":[{"a":1}]},"encoding":{"x":{"field":"a","type":"quantitative"}}}'
const PNG = { ok: true, file: '/tmp/charts-test.png', width: 800, height: 336 }
const mermaid = (body: string) => `\`\`\`mermaid\nflowchart LR\n  ${body}\n\`\`\``
const ENGINE_BAND = { type: 'Text' as const, props: {}, children: ['bande du moteur'] }

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function nodesOf(tree: unknown, type: string): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodesOf(child, type))
  if (tree === null || typeof tree !== 'object') return []
  const node = tree as Node
  const own = node.type === type ? [node] : []
  return [...own, ...nodesOf(node.children ?? [], type)]
}

function textOf(tree: unknown): string {
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (tree === null || typeof tree !== 'object') return ''
  return textOf((tree as Node).children ?? [])
}

/** Un schéma de cette taille naturelle, réduit comme le fait le renderer pour tenir dans width x maxHeight. */
const fittedTo = (natural: { width: number; height: number }) => (input: { width?: number; maxHeight?: number }) => {
  const fit = Math.min(1, (input.width ?? Infinity) / natural.width, (input.maxHeight ?? Infinity) / natural.height)
  return { ...PNG, width: Math.round(natural.width * fit), height: Math.round(natural.height * fit) }
}

type Drawn = { kind: string; source?: string; width?: number; maxHeight?: number; spec?: { hconcat?: unknown[] }; peers?: unknown[] }
type World = { surfaces?: RenderSurface[]; focus?: { deny?: string }; png?: (input: Drawn) => typeof PNG; stored?: Record<string, unknown> }

/**
 * Le moteur sous le mod : surfaces, HOME, focus de la bande, `sh` d'attente qui
 * sort quand son fichier est écrit, dialogue du moteur qui répond « engine ».
 */
function world(on: On, { surfaces = ['terminal'], focus = { deny: 'la bande n’a pas le clavier' }, png = () => PNG, stored }: World = {}) {
  const drawings: Drawn[] = []
  const files = new Map<string, string>()
  const waiters: (() => void)[] = []
  const dialogs: unknown[] = []
  const opened: string[][] = []
  let markAsked = () => {}
  const isAsked = new Promise<void>(resolve => (markAsked = resolve))

  mock.store(on, stored)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('env.get', () => ({ value: '/home/t' }))
  const invalidations: (() => void)[] = []
  const nextInvalidate = () => new Promise<void>(resolve => invalidations.push(resolve))
  on('ui.invalidate', () => {
    markAsked()
    invalidations.splice(0).forEach(resolve => resolve())
    return { value: undefined }
  })
  on('ui.focus', () => focus)
  on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_BAND)
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    waiters.splice(0).forEach(wake => wake())
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    if (e.argv[0] === '/usr/bin/open') {
      opened.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const file = e.argv[0] === '/bin/sh' ? e.argv.at(-1) : undefined
    if (file === undefined) {
      const input: Drawn = JSON.parse(e.init?.stdin ?? '{}')
      drawings.push(input)
      return { value: { exitCode: 0, stdout: JSON.stringify(png(input)), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    while (!files.has(file)) await new Promise<void>(resolve => waiters.push(resolve))
    return { value: { exitCode: 0, stdout: files.get(file) ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    dialogs.push(Reflect.get(e, 'questions'))
    return { result: 'engine' }
  })
  return { drawings, files, dialogs, opened, isAsked, nextInvalidate }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

/** /charts tapé dans le composer */
const charts = (args: string) => ({
  command: 'charts',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

const BAND = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 50 },
  props: { hasSurvey: false, isWorking: true, maxRows: 24, bodyColumns: 120, scroll: { offset: 0, bodyRows: 23 }, view: {} },
} as RenderInput<'AbovePrompt'>

const ARCHI = {
  question: 'Quelle archi ?',
  header: 'Archi',
  multiSelect: false,
  options: [
    { label: 'Monolithe', description: 'Un seul binaire qui scanne, appelle le modèle et rend le rapport, sans file ni worker.', preview: mermaid('A[API] --> B[(Base)]') },
    { label: 'Workers', description: 'une file', preview: `Plus de pièces :\n\n${mermaid('A[API] --> Q[File] --> W[Worker]')}` },
  ],
}

describe('AskUserQuestion dans la bande au-dessus du prompt', () => {
  test('the band shows every option at once, the full description and the diagram of the option shown', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_7' })
    await w.isAsked
    const first = await $.ui.render(BAND)

    const text = JSON.stringify(first)
    expect(text).toContain('Quelle archi ?')
    expect(nodesOf(first, 'Button').map(n => n.props?.key)).toEqual(['option-1', 'option-2', 'annuler', 'ouvrir'])
    // un schéma dans l'aperçu : la description est repliée en entier, sans ligne vide sous elle
    const descriptions = nodesOf(first, 'Text').filter(n => n.props?.dimColor && textOf(n) === ARCHI.options[0]!.description)
    expect(descriptions.map(n => n.props?.wrap)).toEqual(['wrap'])
    // (la marque vide d'une option sans focus, en cyan, n'est pas une ligne vide)
    expect(nodesOf(first, 'Text').filter(n => textOf(n) === ' ' && n.props?.color !== 'cyan')).toHaveLength(0)
    expect(nodesOf(first, 'Image')).toHaveLength(1)
    // 120 colonnes : 32 aux options (le champ Autre sous le focus est le plus large), 2 d'écart,
    // 86 à l'aperçu ; 24 lignes : titre, écart, pied, description sur 1 ligne, il en reste 20 à l'image
    expect(w.drawings.at(-1)).toMatchObject({ kind: 'mermaid', source: 'flowchart LR\n  A[API] --> B[(Base)]', width: 688, maxHeight: 320 })
    // sans le clavier, la bande dit comment le prendre
    expect(text).toContain('ctrl+x tab')

    // 2 depuis le prompt : la description, le texte et le schéma de Workers
    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    const second = await $.ui.render(BAND)
    expect(JSON.stringify(second)).toContain('une file')
    expect(JSON.stringify(second)).not.toContain(ARCHI.options[0]!.description)
    expect(nodesOf(second, 'Markdown').map(n => n.props?.text)).toContain('Plus de pièces :')
    expect(w.drawings.at(-1)).toMatchObject({ kind: 'mermaid', source: 'flowchart LR\n  A[API] --> Q[File] --> W[Worker]' })

    // 2 une seconde fois : choisi, la bande revient au moteur
    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': 'Workers' } } })
    expect(await $.ui.render(BAND)).toMatchObject(ENGINE_BAND)
    expect(w.dialogs).toHaveLength(0)
    expect([...w.files.keys()]).toEqual(['/home/t/.cache/claude-charts/asks/toolu_7.json'])
  })

  test('a short band puts a long description beside a diagram that would be cramped under it', async ($, on) => {
    // le cas vu en session : bande de 10 lignes, description de 3 lignes, flowchart LR large et plat
    const w = world(on, { png: fittedTo({ width: 1100, height: 260 }) })
    await $.session.start(START)
    const description =
      "Même modèle que le jeton Claude : le pod appelle http://proxy/<secret>/<chemin>, le proxy injecte et relaie vers l'hôte fixé par le secret. Pas de CA, pas de TLS terminé, petit diff. git marche via insteadOf, curl via l'URL ; les gates sont réécrites (pas de curl direct vers api.github.com)."
    const question = {
      question: "Quel modèle d'interception pour le proxy multi-secrets ?",
      header: 'Interception',
      multiSelect: false,
      options: [
        { label: 'Relais par URL (Recommande)', description, preview: mermaid('P[Pod agent] --> X[auth-proxy] --> R[Registre]') },
        { label: 'Proxy forward + TLS', description: 'CA injectée', preview: mermaid('P[Pod] --> F[Forward] --> G[api.github.com]') },
      ],
    }
    const short = { ...BAND, viewport: { columns: 165, rows: 40 }, props: { ...BAND.props, bodyColumns: 160, maxRows: 10, scroll: { offset: 0, bodyRows: 9 } } }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_40' })
    await w.isAsked
    const tree = await $.ui.render(short)

    // 160 colonnes : 34 aux options, 124 à droite ; 10 lignes : titre, écart, pied, 7 au corps.
    // Dessous, la description (3 lignes) ne laissait que 4 lignes : 34 x 4 cellules d'image.
    // À côté, elle tient sur 7 lignes en 44 colonnes, l'image a les 7 lignes : 60 x 7.
    const image = nodesOf(tree, 'Image')[0]!
    expect(image.props).toMatchObject({ columns: 60, rows: 7 })
    expect(w.drawings.at(-1)).toMatchObject({ kind: 'mermaid', width: 78 * 8, maxHeight: 112 })
    const beside = nodesOf(tree, 'Box').find(n => n.props?.width === 44)
    expect(beside && nodesOf(beside, 'Text').map(n => [textOf(n), n.props?.wrap])).toEqual([[description, 'wrap']])
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('a description too long to stand beside the image stays whole above it', async ($, on) => {
    const w = world(on, { png: fittedTo({ width: 1100, height: 260 }) })
    await $.session.start(START)
    const description = 'Une description très longue. '.repeat(25).trim()
    const question = { ...ARCHI, options: [{ ...ARCHI.options[0]!, description }, ARCHI.options[1]!] }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_41' })
    await w.isAsked
    const tree = await $.ui.render({ ...BAND, props: { ...BAND.props, maxRows: 14, scroll: { offset: 0, bodyRows: 13 } } })

    // 86 colonnes à droite, 11 lignes au corps : 724 caractères ne tiennent pas en 11 lignes
    // sur les 60 colonnes que l'image laisse au plus ; la description reste au-dessus, entière
    const right = nodesOf(tree, 'Box').find(n => n.props?.width === 86)
    expect(right && nodesOf(right, 'Text').map(n => [textOf(n), n.props?.wrap])).toEqual([[description, 'wrap']])
    expect(w.drawings.every(d => d.width === 86 * 8)).toBe(true)
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('a long description next to a diagram is wrapped whole, never cut, and the image gets the rows left', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const description =
      "L'API pousse un job dans une file (Redis, NATS, SQS...), des workers l'analysent, le client récupère le résultat (polling ou webhook). Scale horizontalement, au prix d'une file à opérer."
    const question = { ...ARCHI, options: [{ ...ARCHI.options[0]!, description }, ARCHI.options[1]!] }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_32' })
    await w.isAsked
    const tree = await $.ui.render(BAND)

    const shown = nodesOf(tree, 'Text').filter(n => n.props?.dimColor && textOf(n) === description)
    expect(shown.map(n => n.props?.wrap)).toEqual(['wrap'])
    expect(nodesOf(tree, 'Text').some(n => n.props?.wrap === 'truncate' && textOf(n).includes('Scale'))).toBe(false)
    // 86 colonnes : la description tient sur 3 lignes ; 24 - titre, écart, pied - 3 = 18 lignes à l'image
    expect(w.drawings.at(-1)).toMatchObject({ kind: 'mermaid', maxHeight: 288 })
    expect(nodesOf(tree, 'Image')[0]!.props?.rows).toBeLessThanOrEqual(18)
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('ouvrir en grand opens the diagram of the option shown at its natural size', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_30' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'ouvrir' })

    expect(w.drawings.at(-1)).toMatchObject({ kind: 'mermaid', source: 'flowchart LR\n  A[API] --> Q[File] --> W[Worker]', width: 8000, opaque: true })
    expect(w.opened).toEqual([['/usr/bin/open', '/tmp/charts-test.png']])
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('an option without a drawing keeps its whole description and has nothing to open', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const question = {
      ...ARCHI,
      options: [ARCHI.options[0]!, { label: 'Texte', description: 'Aperçu sans image.', preview: 'Juste du texte.' }],
    }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_31' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    const tree = await $.ui.render(BAND)

    const descriptions = nodesOf(tree, 'Text').filter(n => n.props?.dimColor && textOf(n) === 'Aperçu sans image.')
    expect(descriptions.map(n => n.props?.wrap)).toEqual(['wrap'])
    expect(nodesOf(tree, 'Button').map(n => n.props?.key)).not.toContain('ouvrir')
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('the arrows on an option show its preview, Enter picks it at once, the hint becomes the arrows', async ($, on) => {
    const w = world(on, { focus: {} })
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_8' })
    await w.isAsked
    await $.ui.render(BAND)
    // la flèche bas de la personne, la bande ayant le clavier
    await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'charts', element: 'option-2', origin: { kind: 'person' } })
    const tree = await $.ui.render(BAND)

    expect(w.drawings.at(-1)).toMatchObject({ source: 'flowchart LR\n  A[API] --> Q[File] --> W[Worker]' })
    expect(JSON.stringify(tree)).toContain('haut/bas')
    expect(JSON.stringify(tree)).not.toContain('ctrl+x tab')
    // Entrée sur l'option sous le focus : choisie d'un coup
    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': 'Workers' } } })
  })

  test('on the Autre field, no option is marked and no preview stays from the last option', async ($, on) => {
    const w = world(on, { focus: {} })
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_17' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'charts', element: 'autre', origin: { kind: 'person' } })
    const drawn = w.drawings.length
    const tree = await $.ui.render(BAND)

    expect(nodesOf(tree, 'Image')).toHaveLength(0)
    expect(w.drawings).toHaveLength(drawn)
    expect(JSON.stringify(tree)).toContain('Tape ta réponse puis Entrée.')
    expect(JSON.stringify(tree)).not.toContain('"> "')
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('once answered, the band is handed back at once, before the call returns', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_18' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'annuler' })

    expect(await $.ui.render(BAND)).toMatchObject(ENGINE_BAND)
    await call
  })

  test('a focus move the engine refuses changes nothing', async ($, on) => {
    const w = world(on, { focus: { deny: 'un autre élément a le clavier' } })
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_15' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'charts', element: 'option-2', origin: { kind: 'person' } })
    const tree = await $.ui.render(BAND)

    expect(w.drawings.at(-1)).toMatchObject({ source: 'flowchart LR\n  A[API] --> B[(Base)]' })
    expect(JSON.stringify(tree)).toContain('ctrl+x tab')
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('each option shows its own vega-lite chart, drawn on the axes shared with the other options', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const offset = { ...JSON.parse(SPEC), title: 'offset' }
    const cursor = { ...JSON.parse(SPEC), title: 'cursor' }
    const fence = (spec: unknown) => `\`\`\`vega-lite\n${JSON.stringify(spec)}\n\`\`\``
    const questions = [
      {
        question: 'Offset ou cursor ?',
        header: 'Pagination',
        multiSelect: false,
        options: [
          { label: 'Offset', description: 'actuel', preview: fence(offset) },
          { label: 'Cursor', description: 'nouveau', preview: fence(cursor) },
        ],
      },
    ]

    const call = $.tool.call({ tool: 'AskUserQuestion', questions, tool_use_id: 'toolu_9' })
    await w.isAsked
    const first = await $.ui.render(BAND)

    // une option, un graphique : jamais ceux des autres options assemblés à côté
    expect(nodesOf(first, 'Image')).toHaveLength(1)
    expect(w.drawings.map(d => d.spec?.hconcat)).toEqual([undefined])
    expect(w.drawings[0]).toMatchObject({ kind: 'vega-lite', spec: offset, peers: [cursor] })

    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    const second = await $.ui.render(BAND)
    expect(nodesOf(second, 'Image')).toHaveLength(1)
    expect(w.drawings.at(-1)).toMatchObject({ kind: 'vega-lite', spec: cursor, peers: [offset] })

    // ouvrir en grand : le graphique de l'option affichée, sur les mêmes axes
    await $.ui.press({ plugin: 'charts', key: 'ouvrir' })
    expect(w.drawings.at(-1)).toMatchObject({ spec: cursor, peers: [offset], width: 1400, opaque: true })

    await $.ui.press({ plugin: 'charts', key: 'option-2' })
    expect(await call).toMatchObject({ result: { answers: { 'Offset ou cursor ?': 'Cursor' } } })
  })

  test('a vega-lite chart next to options drawn otherwise has no axes to share', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const question = {
      ...ARCHI,
      options: [{ ...ARCHI.options[0]!, preview: `\`\`\`vega-lite\n${SPEC}\n\`\`\`` }, ARCHI.options[1]!],
    }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_42' })
    await w.isAsked
    await $.ui.render(BAND)

    expect(w.drawings).toHaveLength(1)
    expect(w.drawings[0]!.kind).toBe('vega-lite')
    expect(w.drawings[0]!.peers).toBeUndefined()
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('on the Autre field, the field gets most of the band and the text typed is shown whole beside it', async ($, on) => {
    const w = world(on, { focus: {} })
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_43' })
    await w.isAsked
    const before = await $.ui.render(BAND)
    const fieldColumn = (tree: unknown) => nodesOf(tree, 'Box').find(n => nodesOf(n.children ?? [], 'Input').length > 0 && n.props?.width !== undefined)
    expect(fieldColumn(before)?.props?.width).toBe(32)

    await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'charts', element: 'autre', origin: { kind: 'person' } })
    // 32 colonnes : le moteur repliait « Autre: » et « envoyer » sur une seconde ligne
    expect(fieldColumn(await $.ui.render(BAND))?.props?.width).toBe(72)

    const typed = 'un monolithe modulaire, découpé par domaine, avec une file pour les scans longs'
    await $.ui.input({ plugin: 'charts', key: 'autre', text: typed, kind: 'change' })
    const echoed = nodesOf(await $.ui.render(BAND), 'Text').filter(n => textOf(n) === typed)
    expect(echoed.map(n => [n.props?.wrap, n.props?.dimColor])).toEqual([['wrap', undefined]])

    // trop long pour la bande : la fin, celle qu'on est en train de taper, précédée de « ... »
    const long = `${'mot '.repeat(120)}fin`
    await $.ui.input({ plugin: 'charts', key: 'autre', text: long, kind: 'change' })
    const short = await $.ui.render({ ...BAND, props: { ...BAND.props, maxRows: 8, scroll: { offset: 0, bodyRows: 7 } } })
    const tail = nodesOf(short, 'Text').map(textOf).find(text => text.startsWith('...'))
    expect(tail?.endsWith('mot fin')).toBe(true)

    await $.ui.input({ plugin: 'charts', key: 'autre', text: typed, kind: 'submit' })
    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': typed } } })
  })

  test('the text typed for one question is not shown under the next one', async ($, on) => {
    const w = world(on, { focus: {} })
    await $.session.start(START)
    const next = { ...ARCHI, question: 'Et la base ?', header: 'Base' }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI, next], tool_use_id: 'toolu_44' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.focus({ component: 'AbovePrompt', requestId: 'band', plugin: 'charts', element: 'autre', origin: { kind: 'person' } })
    await $.ui.input({ plugin: 'charts', key: 'autre', text: 'réponse un', kind: 'change' })
    await $.ui.input({ plugin: 'charts', key: 'autre', text: 'réponse un', kind: 'submit' })
    const tree = await $.ui.render(BAND)

    expect(JSON.stringify(tree)).toContain('Et la base ?')
    expect(JSON.stringify(tree)).not.toContain('réponse un')
    await $.ui.press({ plugin: 'charts', key: 'annuler' })
    await call
  })

  test('several questions, one multiple choice, are answered in turn; Valider sends the ticked ones', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const phases = {
      question: 'Quelles phases ?',
      header: 'Phases',
      multiSelect: true,
      options: [
        { label: 'Lint', description: 'a' },
        { label: 'Tests', description: 'b' },
        { label: 'Review', description: 'c' },
      ],
    }

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI, phases], tool_use_id: 'toolu_10' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'option-1' })
    const second = await $.ui.render(BAND)
    expect(JSON.stringify(second)).toContain('(2/2)')
    expect(JSON.stringify(second)).toContain("pas d'aperçu pour cette option")
    await $.ui.press({ plugin: 'charts', key: 'option-3' })
    await $.ui.press({ plugin: 'charts', key: 'option-1' })
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'valider' })

    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': 'Monolithe', 'Quelles phases ?': 'Lint, Review' } } })
  })

  test('Autre: the text typed answers the question; an empty one answers nothing', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_11' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.input({ plugin: 'charts', key: 'autre', text: '   ', kind: 'submit' })
    expect(w.files.size).toBe(0)
    await $.ui.input({ plugin: 'charts', key: 'autre', text: ' un monolithe modulaire ', kind: 'submit' })

    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': 'un monolithe modulaire' } } })
  })

  test('Annuler refuses the call: the model reads that nothing was answered', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_12' })
    await w.isAsked
    await $.ui.render(BAND)
    await $.ui.press({ plugin: 'charts', key: 'annuler' })

    expect(await call).toEqual({ deny: "L'utilisateur a annulé la question sans répondre." })
    expect(w.dialogs).toHaveLength(0)
  })

  test('a surface without the band, or an id unfit for a file name, gets the engine dialog', async ($, on) => {
    const w = world(on, { surfaces: ['vscode'] })
    await $.session.start(START)

    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_13' })).toEqual({ result: 'engine' })
    expect(w.dialogs).toEqual([[ARCHI]])
    expect(w.files.size).toBe(0)
  })

  test('a tool_use_id that could leave the cache folder is never used as a path', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: '../../etc/x' })).toEqual({ result: 'engine' })
    expect(w.dialogs).toHaveLength(1)
  })

  test('a question without any drawing is left to the engine and the band to whoever draws it', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const plain = { ...ARCHI, options: ARCHI.options.map(o => ({ label: o.label, description: o.description })) }

    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [plain], tool_use_id: 'toolu_14' })).toEqual({ result: 'engine' })
    expect(await $.ui.render(BAND)).toMatchObject(ENGINE_BAND)
  })

  test('/charts band off: a question with drawings opens the engine dialog, previews without their source, the band stays the engine’s', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const fence = `\`\`\`vega-lite\n${SPEC}\n\`\`\``
    const question = {
      question: 'Offset ou cursor ?',
      header: 'Pagination',
      multiSelect: false,
      options: [
        { label: 'Offset', description: 'actuel', preview: fence },
        { label: 'Cursor', description: 'nouveau', preview: fence },
      ],
    }

    expect((await $.command.run(charts('band off'))).text).toContain('bande off')
    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [question], tool_use_id: 'toolu_15' })).toEqual({ result: 'engine' })

    const sent = w.dialogs[0] as (typeof question)[]
    expect(sent[0]!.options.map(o => o.preview)).toEqual([
      '(graphique affiché au-dessus de la question)',
      '(graphique affiché au-dessus de la question)',
    ])
    expect(w.files.size).toBe(0)
    expect(await $.ui.render(BAND)).toMatchObject(ENGINE_BAND)
  })

  test('band off kept from an earlier session gives the engine dialog from the first question', async ($, on) => {
    const w = world(on, { stored: { prefs: { band: false } } })
    await $.session.start(START)

    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_16' })).toEqual({ result: 'engine' })
    expect(w.dialogs).toHaveLength(1)
    expect(w.files.size).toBe(0)
  })

  test('/charts band on brings the band back for the next question', async ($, on) => {
    const w = world(on, { stored: { prefs: { band: false } } })
    await $.session.start(START)

    expect((await $.command.run(charts('band on'))).text).toContain('bande on')
    // le changement de pref a déjà redessiné : on attend le redessin de la question
    const isAsked = w.nextInvalidate()
    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_17' })
    await isAsked
    const band = await $.ui.render(BAND)
    expect(JSON.stringify(band)).toContain('Quelle archi ?')

    await $.ui.press({ plugin: 'charts', key: 'option-1' })
    await $.ui.press({ plugin: 'charts', key: 'option-1' })
    expect(await call).toMatchObject({ result: { answers: { 'Quelle archi ?': 'Monolithe' } } })
    expect(w.dialogs).toHaveLength(0)
  })
})
