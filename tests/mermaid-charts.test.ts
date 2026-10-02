import { describe, expect, test } from 'claude-code/testing'

import { mermaidChart } from '../hooks/mermaid-charts'

type Spec = Record<string, unknown>

function specOf(source: string): Spec {
  const chart = mermaidChart(source)
  if (!chart || !('spec' in chart)) throw new Error(`attendu une spec, reçu ${JSON.stringify(chart)}`)
  return chart.spec
}

function errorOf(source: string): string {
  const chart = mermaidChart(source)
  if (!chart || !('error' in chart)) throw new Error(`attendu une erreur, reçu ${JSON.stringify(chart)}`)
  return chart.error
}

const valuesOf = (spec: Spec) => (spec.data as { values: Record<string, unknown>[] }).values

const GANTT = `gantt
  title Livraison v2
  dateFormat YYYY-MM-DD
  axisFormat %d/%m
  section Backend
  Schéma SQL :done, a1, 2026-10-01, 3d
  API        :active, a2, after a1, 5d
  section Front
  Maquettes  :2026-10-02, 4d
  Écrans     :crit, 2d
  Recette    :milestone, m1, after a2, 0d
  Bascule    :until m1`

describe('mermaid-charts', () => {
  test('other mermaid types are left to beautiful-mermaid', () => {
    expect(mermaidChart('flowchart LR\n  A --> B')).toBeNull()
    expect(mermaidChart('%% commentaire\nsequenceDiagram\n  A->>B: x')).toBeNull()
  })

  test('a pie becomes an arc chart, largest slice first, shares in the legend', () => {
    const spec = specOf('pie title Build\n  "Lint" : 42\n  "Compilation" : 412\n  %% ignoré\n  "Tests" : 188.5')
    expect(spec).toMatchObject({ title: 'Build', description: 'Build', mark: { type: 'arc' } })
    expect(valuesOf(spec).map(v => v.label)).toEqual(['Compilation  64 %', 'Tests  29 %', 'Lint  7 %'])
  })

  test('showData puts the raw value beside the share; a tiny share reads <1 %', () => {
    const spec = specOf('pie showData\n  "Gros" : 999\n  "Miette" : 1')
    expect(valuesOf(spec).map(v => v.label)).toEqual(['Gros  999 (100 %)', 'Miette  1 (<1 %)'])
    expect(spec.title).toBeUndefined()
  })

  test('past eight slices the smallest fold into Autres: the palette is never cycled', () => {
    const slices = Array.from({ length: 10 }, (_, i) => `  "s${i}" : ${10 - i}`).join('\n')
    const labels = valuesOf(specOf(`pie\n${slices}`)).map(v => String(v.label))
    expect(labels).toHaveLength(8)
    // s7, s8, s9 : 3 + 2 + 1
    expect(labels.at(-1)).toBe('Autres  11 %')
  })

  test('a pie line that is not a slice, or a pie of zeros, is an error', () => {
    expect(errorOf('pie\n  Lint : 42')).toBe('pie : ligne illisible : Lint : 42')
    expect(errorOf('pie\n  "a" : 0')).toBe('pie : aucune part non nulle')
    expect(errorOf('pie title Vide')).toBe('pie : aucune part non nulle')
  })

  test('a gantt becomes ranged bars on a UTC time axis, milestones as diamonds', () => {
    const spec = specOf(GANTT)
    expect(valuesOf(spec)).toEqual([
      { task: 'Schéma SQL', section: 'Backend', start: '2026-10-01T00:00:00.000Z', end: '2026-10-04T00:00:00.000Z', isDone: true, isMilestone: false },
      { task: 'API', section: 'Backend', start: '2026-10-04T00:00:00.000Z', end: '2026-10-09T00:00:00.000Z', isDone: false, isMilestone: false },
      { task: 'Maquettes', section: 'Front', start: '2026-10-02T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z', isDone: false, isMilestone: false },
      // sans début, la tâche suit la précédente ; crit est écrit dans le libellé
      { task: 'Écrans (critique)', section: 'Front', start: '2026-10-06T00:00:00.000Z', end: '2026-10-08T00:00:00.000Z', isDone: false, isMilestone: false },
      { task: 'Recette', section: 'Front', start: '2026-10-09T00:00:00.000Z', end: '2026-10-09T00:00:00.000Z', isDone: false, isMilestone: true },
      // until m1 : finit au début du jalon
      { task: 'Bascule', section: 'Front', start: '2026-10-09T00:00:00.000Z', end: '2026-10-09T00:00:00.000Z', isDone: false, isMilestone: false },
    ])
    expect(spec).toMatchObject({
      title: 'Livraison v2',
      encoding: {
        y: { sort: ['Schéma SQL', 'API', 'Maquettes', 'Écrans (critique)', 'Recette', 'Bascule'] },
        color: { field: 'section', sort: ['Backend', 'Front'] },
      },
    })
    const [bars, milestones] = spec.layer as Spec[]
    expect(bars).toMatchObject({ mark: { type: 'bar' }, encoding: { x: { scale: { type: 'utc' }, axis: { format: '%d/%m' } } } })
    expect(milestones).toMatchObject({ mark: { type: 'point', shape: 'diamond' } })
    // 6 lignes de 24 px, l'axe, le titre et la légende
    expect(spec.height).toBe(6 * 24 + 30 + 30 + 30)
  })

  test('durations in hours and weeks, dates with a time; no section means no legend', () => {
    const spec = specOf('gantt\n  Migration :2026-10-01 08:30, 4h\n  Rodage :1.5w')
    expect(valuesOf(spec).map(v => [v.start, v.end])).toEqual([
      ['2026-10-01T08:30:00.000Z', '2026-10-01T12:30:00.000Z'],
      ['2026-10-01T12:30:00.000Z', '2026-10-12T00:30:00.000Z'],
    ])
    expect((spec.encoding as Spec).color).toBeUndefined()
    expect(spec.height).toBe(2 * 24 + 30)
    // pas d'axisFormat : dates françaises, l'heure puisqu'il y en a
    expect((spec.layer as Spec[])[0]).toMatchObject({ encoding: { x: { axis: { format: '%d/%m %Hh%M' } } } })
    expect((specOf('gantt\n  A :2026-10-01, 2d').layer as Spec[])[0]).toMatchObject({ encoding: { x: { axis: { format: '%d/%m' } } } })
  })

  test('each unreadable gantt says which task and why', () => {
    expect(errorOf('gantt\n  title Rien')).toBe('gantt : aucune tâche')
    expect(errorOf('gantt\n  Seule : 3d')).toBe('gantt : "Seule" : ni date de début ni tâche avant')
    expect(errorOf('gantt\n  A : after zz, 3d')).toBe('gantt : "A" : tâche inconnue dans "after zz"')
    expect(errorOf('gantt\n  A : 2026-02-31, 3d')).toBe('gantt : "A" : date illisible "2026-02-31" (format YYYY-MM-DD ou YYYY-MM-DD HH:mm)')
    expect(errorOf('gantt\n  A : 2026-10-05, 2026-10-01')).toBe('gantt : "A" : la fin "2026-10-01" est avant le début')
    expect(errorOf('gantt\n  A : 2026-10-05, demain')).toBe('gantt : "A" : fin illisible "demain" (date YYYY-MM-DD ou durée : 3d, 2w, 4h)')
    expect(errorOf('gantt\n  A : 2026-10-05, until zz')).toBe('gantt : "A" : tâche inconnue dans "until zz"')
    expect(errorOf('gantt\n  A : done')).toBe('gantt : "A" : il faut une fin ou une durée, et au plus id, début, fin')
    expect(errorOf('gantt\n  sans deux-points')).toBe('gantt : ligne illisible : sans deux-points')
  })
})
