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

type World ={ surfaces?: RenderSurface[]; focus?: { deny?: string } }

/**
 * Le moteur sous le mod : surfaces, HOME, focus de la bande, `sh` d'attente qui
 * sort quand son fichier est écrit, dialogue du moteur qui répond « engine ».
 */
function world(on: On, { surfaces = ['terminal'], focus = { deny: 'la bande n’a pas le clavier' } }: World = {}) {
  const drawings: { kind: string; source?: string; width?: number; spec?: { hconcat?: unknown[] } }[] = []
  const files = new Map<string, string>()
  const waiters: (() => void)[] = []
  const dialogs: unknown[] = []
  const opened: string[][] = []
  let markAsked = () => {}
  const isAsked = new Promise<void>(resolve => (markAsked = resolve))

  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('env.get', () => ({ value: '/home/t' }))
  on('ui.invalidate', () => {
    markAsked()
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
      drawings.push(JSON.parse(e.init?.stdin ?? '{}'))
      return { value: { exitCode: 0, stdout: JSON.stringify(PNG), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    while (!files.has(file)) await new Promise<void>(resolve => waiters.push(resolve))
    return { value: { exitCode: 0, stdout: files.get(file) ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    dialogs.push(Reflect.get(e, 'questions'))
    return { result: 'engine' }
  })
  return { drawings, files, dialogs, opened, isAsked }
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

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
    expect(await $.ui.render(BAND)).toEqual(ENGINE_BAND)
    expect(w.dialogs).toHaveLength(0)
    expect([...w.files.keys()]).toEqual(['/home/t/.cache/claude-charts/asks/toolu_7.json'])
  })

  test('a short band still holds the whole question: the image gets only the rows left', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: [ARCHI], tool_use_id: 'toolu_16' })
    await w.isAsked
    const tree = await $.ui.render({ ...BAND, props: { ...BAND.props, maxRows: 12, scroll: { offset: 0, bodyRows: 11 } } })

    // 12 lignes : titre 1, écart 1, pied 1, description 1 (sans ligne vide) : 8 pour l'image
    expect(w.drawings.at(-1)).toMatchObject({ maxHeight: 128 })
    expect(nodesOf(tree, 'Image')[0]!.props?.rows).toBeLessThanOrEqual(8)
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

    expect(await $.ui.render(BAND)).toEqual(ENGINE_BAND)
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

  test('vega-lite previews are one image beside the options, every option on shared scales', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const fence = `\`\`\`vega-lite\n${SPEC}\n\`\`\``
    const questions = [
      {
        question: 'Offset ou cursor ?',
        header: 'Pagination',
        multiSelect: false,
        options: [
          { label: 'Offset', description: 'actuel', preview: fence },
          { label: 'Cursor', description: 'nouveau', preview: fence },
        ],
      },
    ]

    const call = $.tool.call({ tool: 'AskUserQuestion', questions, tool_use_id: 'toolu_9' })
    await w.isAsked
    const tree = await $.ui.render(BAND)

    expect(nodesOf(tree, 'Image')).toHaveLength(1)
    expect(w.drawings).toHaveLength(1)
    expect(w.drawings[0]!.spec?.hconcat).toHaveLength(2)
    await $.ui.press({ plugin: 'charts', key: 'option-1' })
    expect(await call).toMatchObject({ result: { answers: { 'Offset ou cursor ?': 'Offset' } } })
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
    expect(await $.ui.render(BAND)).toEqual(ENGINE_BAND)
  })
})
