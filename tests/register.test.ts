import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, RenderInput } from 'claude-code'

const SPEC = '{"mark":"bar","data":{"values":[{"a":1}]},"encoding":{"x":{"field":"a","type":"quantitative"}}}'
const MESSAGE = `Voici :\n\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\n\nFin.`
const PNG = { ok: true, file: '/tmp/charts-test.png', width: 800, height: 336 }

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
  const node = tree as Node
  const own = node.type === 'Markdown' ? String(node.props?.text ?? '') : ''
  return own + textOf(node.children ?? [])
}

/** Le monde sous le mod : store, commandes, renderer et rendu du moteur. */
function world(on: On, rendered: object = PNG, opener = { exitCode: 0, stderr: '' }) {
  const runs: string[] = []
  const opened: string[][] = []
  const toasts: string[] = []
  const leads: string[] = []
  const asked: unknown[] = []
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const result = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    // la visionneuse du système : macOS ici
    if (e.argv[0] === '/usr/bin/open') {
      opened.push([...e.argv])
      return { value: { ...result, ...opener } }
    }
    runs.push(e.init?.stdin ?? '')
    return { value: { ...result, stdout: JSON.stringify(rendered) } }
  })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    leads.push(e.props.text)
    return { type: 'engine' as const, ref: 0 }
  })
  on('ui.render', { component: 'AskUserQuestion' }, ($, e) => {
    asked.push(e.props.questions)
    return { type: 'engine' as const, ref: 0 }
  })
  return { runs, opened, toasts, leads, asked }
}

function message(text: string, surface: 'terminal' | 'desktop' = 'terminal'): RenderInput<'AssistantMessage'> {
  return {
    component: 'AssistantMessage',
    surface,
    requestId: 'msg-1',
    viewport: { columns: 120, rows: 40 },
    props: { text, isFirstOfReply: true },
  } as RenderInput<'AssistantMessage'>
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

/** /charts tapé dans le composer d'un terminal de 120 colonnes */
const charts = (args: string) => ({
  command: 'charts',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 120 },
})

describe('register', () => {
  test('a closed vega-lite block becomes an Image between the two texts', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const tree = await $.ui.render(message(MESSAGE))

    expect(w.leads).toEqual(['Voici :'])
    const images = nodesOf(tree, 'Image')
    expect(images).toHaveLength(1)
    expect(images[0]!.props).toMatchObject({
      source: { file: '/tmp/charts-test.png', format: 'png' },
      columns: 100,
      rows: 21,
    })
    expect(textOf(tree)).toContain('Fin.')
    const sent = JSON.parse(w.runs[0]!)
    expect(sent).toMatchObject({ kind: 'vega-lite', width: 800, theme: 'dark', format: 'png', maxHeight: 352 })
    expect(sent.spec).toEqual(JSON.parse(SPEC))
  })

  test('a dot block becomes an Image named after the graph, its DOT sent as is', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const dot = 'digraph slopguard {\n  rankdir=LR\n  diff -> regles -> score\n}'

    const tree = await $.ui.render(message(`Comment ça marche :\n\n\`\`\`dot\n${dot}\n\`\`\`\n\nVoilà.`))

    expect(w.leads).toEqual(['Comment ça marche :'])
    const images = nodesOf(tree, 'Image')
    expect(images).toHaveLength(1)
    expect(images[0]!.props).toMatchObject({ alt: 'schéma slopguard' })
    expect(JSON.parse(w.runs[0]!)).toMatchObject({ kind: 'dot', source: dot, format: 'png' })
  })

  test('a mermaid diagram uses the full width and twice the chart height, a chart keeps its own size', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const mermaid = 'sequenceDiagram\n  U->>G: mention\n  G->>W: webhook'
    const text = `\`\`\`mermaid\n${mermaid}\n\`\`\`\n\nEt les chiffres :\n\n\`\`\`vega-lite\n${SPEC}\n\`\`\``

    const tree = await $.ui.render(message(text))

    // le message commence par un schéma : le moteur garde la puce sur une amorce
    expect(w.leads).toEqual(['Schéma :'])
    expect(nodesOf(tree, 'Image')[0]!.props).toMatchObject({ alt: 'schéma sequenceDiagram' })
    const [diagram, chart] = w.runs.map(run => JSON.parse(run))
    // 120 colonnes - retrait - marge = 116 colonnes de 8 px ; 44 lignes de 16 px
    expect(diagram).toMatchObject({ kind: 'mermaid', source: mermaid, width: 928, maxHeight: 704 })
    expect(chart).toMatchObject({ kind: 'vega-lite', width: 800, maxHeight: 352 })
  })

  test('a dot block graphviz cannot lay out keeps its source visible with the reason', async ($, on) => {
    world(on, { ok: false, error: "DOT invalide : syntax error in line 1 near '}'" })
    await $.session.start(START)

    const tree = await $.ui.render(message('```dot\ndigraph { a -> }\n```'))

    expect(textOf(tree)).toContain('digraph { a -> }')
    expect(JSON.stringify(tree)).toContain('DOT invalide')
    expect(nodesOf(tree, 'Image')).toHaveLength(0)
  })

  test('a mermaid pie or gantt is sent as a vega-lite chart, at chart size', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const tree = await $.ui.render(message('Répartition :\n\n```mermaid\npie title Build\n  "Tests" : 3\n  "Lint" : 1\n```'))

    expect(nodesOf(tree, 'Image')[0]!.props).toMatchObject({ alt: 'Build' })
    const sent = JSON.parse(w.runs[0]!)
    expect(sent).toMatchObject({ kind: 'vega-lite', width: 800, maxHeight: 352, spec: { mark: { type: 'arc' } } })
  })

  test('a mermaid gantt the mod cannot read keeps its source with the reason', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const tree = await $.ui.render(message('```mermaid\ngantt\n  A : after zz, 3d\n```'))

    expect(w.runs).toHaveLength(0)
    expect(textOf(tree)).toContain('A : after zz, 3d')
    expect(JSON.stringify(tree)).toContain('charts : gantt : \\"A\\" : tâche inconnue dans \\"after zz\\"')
  })

  test('ouvrir en grand renders a large PNG on the theme background and opens it', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const tree = await $.ui.render(message(MESSAGE))
    const button = nodesOf(tree, 'Button').find(b => b.props?.key === 'open-0')
    expect(JSON.stringify(button)).toContain('ouvrir en grand')

    await $.ui.press({ plugin: 'charts', key: 'open-0' })

    expect(JSON.parse(w.runs.at(-1)!)).toMatchObject({ kind: 'vega-lite', width: 1400, maxHeight: 900, scale: 2, opaque: true, format: 'png' })
    expect(w.opened).toEqual([['/usr/bin/open', '/tmp/charts-test.png']])
    expect(w.toasts).toEqual([])
  })

  test('a viewer that fails says why in a toast', async ($, on) => {
    const w = world(on, PNG, { exitCode: 1, stderr: 'No application knows how to open' })
    await $.session.start(START)
    await $.ui.render(message(MESSAGE))

    await $.ui.press({ plugin: 'charts', key: 'open-0' })

    expect(w.toasts).toEqual(['charts : ouverture impossible : No application knows how to open'])
  })

  test('on the desktop the chart is an Svg, rendered as svg', async ($, on) => {
    const w = world(on, { ok: true, svg: '<svg width="720" height="302"></svg>', width: 720, height: 302 })
    await $.session.start(START)

    const tree = await $.ui.render(message(MESSAGE, 'desktop'))

    expect(nodesOf(tree, 'Image')).toHaveLength(0)
    expect(nodesOf(tree, 'Svg')[0]!.props).toMatchObject({ source: '<svg width="720" height="302"></svg>', width: 720 })
    expect(JSON.parse(w.runs[0]!).format).toBe('svg')
  })

  test('a block still streaming is left to the engine, untouched', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const streaming = `Voici :\n\n\`\`\`vega-lite\n${SPEC}`

    await $.ui.render(message(streaming))

    expect(w.leads).toEqual([streaming])
    expect(w.runs).toHaveLength(0)
  })

  test('invalid JSON keeps the code visible with the error, no render', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const tree = await $.ui.render(message('Voici :\n```vega-lite\n{"mark": \n```'))

    expect(w.runs).toHaveLength(0)
    expect(nodesOf(tree, 'Image')).toHaveLength(0)
    expect(textOf(tree)).toContain('{"mark":')
    expect(JSON.stringify(tree)).toContain('JSON invalide')
  })

  test('a renderer failure shows its reason under the code', async ($, on) => {
    world(on, { ok: false, error: 'Unrecognized data set: table' })
    await $.session.start(START)

    const tree = await $.ui.render(message(MESSAGE))

    expect(nodesOf(tree, 'Image')).toHaveLength(0)
    expect(JSON.stringify(tree)).toContain('Unrecognized data set: table')
  })

  // zoom : le moteur abandonne le rendu et tue node ; avant, le mod essayait les autres
  // binaires, affichait l'ENOENT du dernier et gardait cet échec pour cette largeur
  test('an abandoned render tries no other node, shows its own reason and is retried on the next render', async ($, on) => {
    const argv: string[] = []
    let isAborting = true
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('process.run', ($, e) => {
      argv.push(e.argv[0]!)
      if (isAborting) return { deny: `$.process.run(${e.argv[0]}) aborted` }
      return { value: { exitCode: 0, stdout: JSON.stringify(PNG), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine' as const, ref: 0 }))
    await $.session.start(START)

    const abandoned = await $.ui.render(message(MESSAGE))
    expect(argv).toEqual(['node'])
    expect(JSON.stringify(abandoned)).toContain('aborted')
    expect(JSON.stringify(abandoned)).not.toContain('ENOENT')

    isAborting = false
    const tree = await $.ui.render(message(MESSAGE))
    expect(argv).toEqual(['node', 'node'])
    expect(nodesOf(tree, 'Image')).toHaveLength(1)
  })

  test('a node that does not start makes the next binary run', async ($, on) => {
    const argv: string[] = []
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('process.run', ($, e) => {
      argv.push(e.argv[0]!)
      if (e.argv[0] === 'node') return { deny: '$.process.run(node) failed to start: ENOENT: no such file or directory' }
      return { value: { exitCode: 0, stdout: JSON.stringify(PNG), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine' as const, ref: 0 }))
    await $.session.start(START)

    const tree = await $.ui.render(message(MESSAGE))

    expect(argv).toEqual(['node', '/opt/homebrew/bin/node'])
    expect(nodesOf(tree, 'Image')).toHaveLength(1)
  })

  test('/charts off hands every message back to the engine, /charts on brings images back', async ($, on) => {
    const w = world(on)
    await $.session.start(START)

    const off = await $.command.run(charts('off'))
    expect(off.text).toContain('charts off')
    await $.ui.render(message(MESSAGE))
    expect(w.leads).toEqual([MESSAGE])
    expect(w.runs).toHaveLength(0)

    await $.command.run(charts('on'))
    const tree = await $.ui.render(message(MESSAGE))
    expect(nodesOf(tree, 'Image')).toHaveLength(1)
  })

  test('a bad /charts argument is refused and changes nothing', async ($, on) => {
    world(on)
    await $.session.start(START)

    const refused = await $.command.run(charts('width 10'))
    expect(refused.text).toContain('width : entier de 20 à 255')
    const status = await $.command.run(charts(''))
    expect(status.text).toContain('largeur max 100 col')
  })

  test('AskUserQuestion: previews lose their JSON, each option gets its chart under the dialog', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const fence = `\`\`\`vega-lite\n${SPEC}\n\`\`\``
    const questions = [
      {
        question: 'Quelle stratégie de cache ?',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: 'sccache local', description: 'actuel', preview: `Disque : 38 Go\n${fence}` },
          { label: 'sccache + Redis', description: 'partagé', preview: fence },
          { label: 'Rien', description: 'sans cache' },
        ],
      },
    ]

    const tree = await $.ui.render({
      component: 'AskUserQuestion',
      surface: 'terminal',
      requestId: 'toolu_1',
      viewport: { columns: 120, rows: 40 },
      props: { tool: 'AskUserQuestion', questions },
    } as RenderInput<'AskUserQuestion'>)

    const drawn = w.asked[0] as typeof questions
    expect(drawn[0]!.options[0]!.preview).toBe('Disque : 38 Go\n(graphique affiché au-dessus de la question)')
    expect(drawn[0]!.options[1]!.preview).toBe('(graphique affiché au-dessus de la question)')
    expect(drawn[0]!.options[2]!.preview).toBeUndefined()
    // une seule image : le moteur additionne les lignes d'une rangée, 2 cartes ne tiendraient pas
    const images = nodesOf(tree, 'Image')
    expect(images).toHaveLength(1)
    // PNG de 800 px : 100 colonnes ; le ratio donnerait 21 lignes, plafonnées à 10 pour le dialogue,
    // et la largeur suit (100 x 10 / 21) pour que l'image ne soit pas écrasée
    expect(images[0]!.props).toMatchObject({ columns: 48, rows: 10 })
    expect(w.runs).toHaveLength(1)
    const sent = JSON.parse(w.runs[0]!)
    expect(sent).toMatchObject({ width: 928, maxHeight: 160 })
    expect(sent.spec.hconcat.map((s: { title: string }) => s.title)).toEqual(['1. sccache local', '2. sccache + Redis'])
    expect(sent.spec.resolve).toEqual({ scale: { x: 'shared', y: 'shared', color: 'shared' } })
    // les aperçus sont dessinés avant le dialogue, que le moteur garde en dernier
    const children = (tree as Node).children ?? []
    expect(children.at(-1)).toEqual({ type: 'engine', ref: expect.any(Number) })
  })

  test('AskUserQuestion with one broken preview charts the others and names the broken one', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const questions = [
      {
        question: 'Laquelle ?',
        header: 'Choix',
        multiSelect: false,
        options: [
          { label: 'A', description: 'a', preview: `\`\`\`vega-lite\n${SPEC}\n\`\`\`` },
          { label: 'B', description: 'b', preview: '```vega-lite\n{"mark": \n```' },
        ],
      },
    ]

    const tree = await $.ui.render({
      component: 'AskUserQuestion',
      surface: 'terminal',
      requestId: 'toolu_4',
      viewport: { columns: 120, rows: 40 },
      props: { tool: 'AskUserQuestion', questions },
    } as RenderInput<'AskUserQuestion'>)

    expect(nodesOf(tree, 'Image')).toHaveLength(1)
    expect(JSON.stringify(tree)).toContain("aperçu illisible pour l'option 2")
    const sent = JSON.parse(w.runs[0]!)
    expect(sent.spec.hconcat).toHaveLength(1)
    // la ligne d'erreur en plus : l'image passe de 10 à 8 lignes pour que le moteur accepte
    expect(sent.maxHeight).toBe(128)
  })

  test('AskUserQuestion with a broken chart keeps the row to one error line', async ($, on) => {
    world(on)
    await $.session.start(START)
    const questions = [
      {
        question: 'Laquelle ?',
        header: 'Choix',
        multiSelect: false,
        options: [
          { label: 'A', description: 'a', preview: '```vega-lite\n{"mark": \n```' },
          { label: 'B', description: 'b' },
        ],
      },
    ]

    const tree = await $.ui.render({
      component: 'AskUserQuestion',
      surface: 'terminal',
      requestId: 'toolu_3',
      viewport: { columns: 120, rows: 40 },
      props: { tool: 'AskUserQuestion', questions },
    } as RenderInput<'AskUserQuestion'>)

    expect(nodesOf(tree, 'Markdown')).toHaveLength(0)
    expect(nodesOf(tree, 'Image')).toHaveLength(0)
    expect(JSON.stringify(tree)).toContain("aperçu illisible pour l'option 1")
  })

  test('AskUserQuestion through tool.call, no band on the surface: the dialog gets the previews without JSON, the charts still draw', async ($, on) => {
    const w = world(on)
    on('env.get', () => ({ value: '/home/t' }))
    on('session.surfaces', () => ({ value: ['vscode' as const] }))
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
    let dialogInput: unknown
    let drawn: unknown
    // le moteur sous le mod : il ouvre le dialogue avec ce que tool.call lui passe
    on('tool.call', async (_, e) => {
      dialogInput = Reflect.get(e, 'questions')
      drawn = await $.ui.render({
        component: 'AskUserQuestion',
        surface: 'terminal',
        requestId: 'toolu_9',
        viewport: { columns: 120, rows: 40 },
        props: { tool: 'AskUserQuestion', questions: dialogInput as unknown[] },
      } as RenderInput<'AskUserQuestion'>)
      return { result: 'answered' }
    })
    await $.session.start(START)

    await $.tool.call({ tool: 'AskUserQuestion', questions, tool_use_id: 'toolu_9' })

    const sentToDialog = dialogInput as typeof questions
    expect(sentToDialog[0]!.options.map(o => o.preview)).toEqual([
      '(graphique affiché au-dessus de la question)',
      '(graphique affiché au-dessus de la question)',
    ])
    expect(nodesOf(drawn, 'Image')).toHaveLength(1)
    const sent = JSON.parse(w.runs[0]!)
    expect(sent.spec.hconcat.map((s: { title: string }) => s.title)).toEqual(['1. Offset', '2. Cursor'])
  })

  test('AskUserQuestion without any chart is left to the engine as is', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const questions = [{ question: 'Oui ?', header: 'Q', multiSelect: false, options: [{ label: 'a', description: 'b' }, { label: 'c', description: 'd' }] }]

    await $.ui.render({
      component: 'AskUserQuestion',
      surface: 'terminal',
      requestId: 'toolu_2',
      props: { tool: 'AskUserQuestion', questions },
    } as RenderInput<'AskUserQuestion'>)

    expect(w.asked[0]).toEqual(questions)
    expect(w.runs).toHaveLength(0)
  })

  test('the system prompt gains the charts guide only while charts is on', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' as const }] }))
    await $.session.start(START)

    const request = {
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: ['terminal'] as const,
      tools: [],
      outputStyle: null,
      traits: [],
    }
    const withGuide = await $.prompt.compose(request)
    expect(withGuide.sections.map(s => s.id)).toEqual(['intro', 'charts:guide'])
    expect(withGuide.sections[1]!.text).toContain('vega-lite')

    await $.command.run(charts('off'))
    const without = await $.prompt.compose(request)
    expect(without.sections.map(s => s.id)).toEqual(['intro'])
  })
})
