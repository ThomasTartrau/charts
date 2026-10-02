import { describe, expect, test } from 'claude-code/testing'

import { chartBlocksOf, parseSpec, segmentsOf, withoutCharts } from '../hooks/fences'

const SPEC = '{"mark":"bar","data":{"values":[{"a":1}]}}'

describe('fences', () => {
  test('finds each closed vega-lite fence with its exact offsets', async () => {
    const text = `Avant\n\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\n\nentre\n\n~~~vegalite\n${SPEC}\n~~~\nfin`
    const blocks = chartBlocksOf(text)
    expect(blocks.map(b => b.source)).toEqual([SPEC, SPEC])
    expect(text.slice(blocks[0]!.start, blocks[0]!.end)).toBe(`\`\`\`vega-lite\n${SPEC}\n\`\`\``)
    expect(text.slice(blocks[1]!.start, blocks[1]!.end)).toBe(`~~~vegalite\n${SPEC}\n~~~`)
  })

  test('mermaid, dot and graphviz fences are diagrams, vega-lite fences are charts', async () => {
    const text = `\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n\`\`\`dot\ndigraph { a -> b }\n\`\`\`\n\`\`\`graphviz\ndigraph { c }\n\`\`\`\n\`\`\`vl\n${SPEC}\n\`\`\``
    expect(chartBlocksOf(text).map(b => [b.kind, b.source])).toEqual([
      ['mermaid', 'flowchart LR\n  A --> B'],
      ['dot', 'digraph { a -> b }'],
      ['dot', 'digraph { c }'],
      ['vega-lite', SPEC],
    ])
  })

  test('an unclosed fence, as while streaming, is not a chart yet', async () => {
    expect(chartBlocksOf(`\`\`\`vega-lite\n${SPEC}`)).toEqual([])
  })

  test('other languages, empty fences and look-alike names are left alone', async () => {
    expect(chartBlocksOf(`\`\`\`json\n${SPEC}\n\`\`\``)).toEqual([])
    expect(chartBlocksOf('```vega-lite\n\n```')).toEqual([])
    expect(chartBlocksOf(`\`\`\`vega-lite-x\n${SPEC}\n\`\`\``)).toEqual([])
  })

  test('a vega-lite fence inside another fence is code, not a chart', async () => {
    const text = `\`\`\`\`markdown\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\n\`\`\`\``
    expect(chartBlocksOf(text)).toEqual([])
  })

  test('segments keep the order text, chart, text and drop blank edges', async () => {
    const text = `Voici :\n\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\n\nFin.`
    const segments = segmentsOf(text, chartBlocksOf(text))
    expect(segments.map(s => s.kind)).toEqual(['text', 'chart', 'text'])
    expect(segments[0]).toEqual({ kind: 'text', text: 'Voici :' })
    expect(segments[2]).toEqual({ kind: 'text', text: 'Fin.' })
  })

  test('a message that is only a chart is one chart segment', async () => {
    const text = `\`\`\`vega-lite\n${SPEC}\n\`\`\``
    expect(segmentsOf(text, chartBlocksOf(text)).map(s => s.kind)).toEqual(['chart'])
  })

  test('parseSpec returns the object, or says why it cannot', async () => {
    expect(parseSpec(SPEC)).toEqual({ spec: { mark: 'bar', data: { values: [{ a: 1 }] } } })
    const broken = parseSpec('{"mark": ')
    expect('error' in broken && broken.error.startsWith('JSON invalide')).toBe(true)
    expect(parseSpec('[1, 2]')).toEqual({ error: 'la spec doit être un objet JSON' })
    expect(parseSpec('42')).toEqual({ error: 'la spec doit être un objet JSON' })
  })

  test('withoutCharts swaps each chart for the label and keeps the rest', async () => {
    const text = `Coût :\n\`\`\`vega-lite\n${SPEC}\n\`\`\`\nfin`
    expect(withoutCharts(text, '[graphique]')).toBe('Coût :\n[graphique]\nfin')
    expect(withoutCharts('rien', '[graphique]')).toBe('rien')
  })

  test('withoutCharts leaves a dot diagram in place: only charts are drawn above a question', async () => {
    const text = '```dot\ndigraph { a -> b }\n```'
    expect(withoutCharts(text, '[graphique]')).toBe(text)
  })
})
