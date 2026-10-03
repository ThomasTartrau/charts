import { describe, expect, test } from 'claude-code/testing'
import type { On, RenderInput } from 'claude-code'

import { displayOf, hasPlaceholder, placeholderOf, restoredFrom, START, type StreamState } from '../hooks/streaming'

const SPEC = '{\n  "title": "Ventes 2026",\n  "mark": "bar"\n}'
const REPLY = `Voici :\n\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\n\nLa suite.\n`

/** Le texte affiché quand la réponse arrive par lots de `size` lignes. */
function shownBy(reply: string, size: number): string {
  const lines = reply.split('\n').slice(0, -1).map(line => line + '\n')
  let state: StreamState = START
  let text = ''
  for (let at = 0; at < lines.length; at += size) {
    const display = displayOf(state, lines.slice(at, at + size).join(''))
    state = display.state
    text += display.text
  }
  return text
}

describe('displayOf', () => {
  test('the chart source is hidden and its title stands in its place, whatever the batches', async () => {
    for (const size of [1, 2, 5, 100]) {
      expect(shownBy(REPLY, size)).toBe('Voici :\n\n*Graphique "Ventes 2026" : dessiné à la fin de la réponse*\n\nLa suite.\n')
    }
  })

  test('mermaid and dot sources are hidden as diagrams', async () => {
    const reply = '```mermaid\nflowchart LR\n  A --> B\n```\n```dot\ndigraph { a -> b }\n```\n'
    expect(shownBy(reply, 1)).toBe('*Schéma mermaid : dessiné à la fin de la réponse*\n*Schéma dot : dessiné à la fin de la réponse*\n')
  })

  test('ordinary code and a chart fence inside it stay visible', async () => {
    const reply = '````markdown\n```vega-lite\n{}\n```\n````\n```json\n{"a": 1}\n```\n'
    expect(shownBy(reply, 1)).toBe(reply)
  })

  test('a batch hidden whole is empty text, a final batch may end mid-line', async () => {
    const opened = displayOf(START, '```vega-lite\n{\n')
    expect(opened.text).toBe('')
    const last = displayOf(opened.state, '}\n```\nFin sans saut')
    expect(last.text).toBe('*Graphique : dessiné à la fin de la réponse*\nFin sans saut')
    expect(last.state).toEqual(START)
  })

  test('a title that is an object or an array, or JSON that does not parse, still gives a line', async () => {
    expect(placeholderOf('vega-lite', '{"title": {"text": ["Deux", "lignes"]}}')).toBe('*Graphique "Deux lignes" : dessiné à la fin de la réponse*')
    expect(placeholderOf('vega-lite', '{"title": ')).toBe('*Graphique : dessiné à la fin de la réponse*')
  })
})

describe('restoredFrom', () => {
  const shown = displayOf(START, REPLY).text

  test('each placeholder line gets its source back from the stored reply that gave it', async () => {
    expect(hasPlaceholder(shown)).toBe(true)
    expect(restoredFrom(shown, ['Autre réponse', REPLY, 'Plus récente, sans graphique'])).toBe(REPLY)
  })

  test('two untitled charts come back in order, from the newest reply that matches', async () => {
    const two = 'A\n```vega-lite\n{"mark":"bar"}\n```\nB\n```vega-lite\n{"mark":"line"}\n```\nC'
    const older = 'A\n```vega-lite\n{"mark":"point"}\n```\nB\n```vega-lite\n{"mark":"area"}\n```\nC'
    expect(restoredFrom(displayOf(START, two).text, [older, two])).toBe(two)
  })

  test('a reply stored joined with other blocks is still found', async () => {
    expect(restoredFrom(shown, [`Premier bloc.\n${REPLY}Bloc suivant.`])).toBe(REPLY)
  })

  test('no stored reply gave this text: null, and ordinary text has no placeholder', async () => {
    expect(restoredFrom(shown, ['Rien à voir'])).toBeNull()
    expect(hasPlaceholder('Un texte *en italique* ordinaire')).toBe(false)
  })
})

const BASE = { session_id: 's1', transcript_path: '/t.jsonl', cwd: '/work', turn_id: 'turn-1' }
const START_SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

/** Le moteur sous le mod : le texte affiché tel que le modèle l'écrit. */
function world(on: On) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('classic.MessageDisplay', () => ({}))
}

describe('streaming hooks', () => {
  test('the source stays hidden across flushes, the next message starts afresh', async ($, on) => {
    world(on)
    await $.session.start(START_SESSION)
    const flush = (message_id: string, index: number, delta: string, final = false) =>
      $.classic.MessageDisplay({ ...BASE, message_id, index, delta, final })

    expect(await flush('m1', 0, 'Voici :\n```vega-lite\n{\n')).toMatchObject({ displayContent: 'Voici :\n' })
    expect(await flush('m1', 1, '"mark": "bar"\n')).toMatchObject({ displayContent: '' })
    expect(await flush('m1', 2, '}\n```\nSuite\n', true)).toMatchObject({
      displayContent: '*Graphique : dessiné à la fin de la réponse*\nSuite\n',
    })
    // un message interrompu dans sa source ne cache rien du suivant
    await flush('m2', 0, '```dot\n')
    expect(await flush('m3', 0, 'Texte libre\n')).toMatchObject({ displayContent: 'Texte libre\n' })
  })

  test('the finished block, drawn from the streamed text, gets its chart from the stored reply', async ($, on) => {
    world(on)
    const stored = 'Voici :\n```vega-lite\n{"mark": "bar"}\n```\nSuite.'
    const asked: string[] = []
    on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: stored, toolUses: [] }] }))
    on('process.run', ($, e) => {
      asked.push(e.init?.stdin ?? '')
      const out = { ok: true, file: '/tmp/charts-test.png', width: 800, height: 336 }
      return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('ui.render', { component: 'AssistantMessage' }, () => ({ type: 'engine' as const, ref: 0 }))
    await $.session.start(START_SESSION)

    const tree = await $.ui.render({
      component: 'AssistantMessage',
      surface: 'terminal',
      requestId: 'msg-1',
      viewport: { columns: 120, rows: 40 },
      props: { text: displayOf(START, stored).text, isFirstOfReply: true },
    } as RenderInput<'AssistantMessage'>)

    expect(JSON.stringify(tree)).toContain('"Image"')
    expect(JSON.parse(asked[0]!).spec).toEqual({ mark: 'bar' })
  })

  test('/charts off leaves the streamed text as is', async ($, on) => {
    world(on)
    on('store.get', () => ({ value: { enabled: false } }))
    await $.session.start(START_SESSION)

    const shown = await $.classic.MessageDisplay({ ...BASE, message_id: 'm1', index: 0, delta: '```vega-lite\n{}\n', final: false })

    expect(shown.displayContent).toBeUndefined()
  })
})
