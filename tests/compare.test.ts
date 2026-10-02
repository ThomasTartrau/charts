import { describe, expect, test } from 'claude-code/testing'

import { combinedSpec } from '../hooks/compare'

const BAR = { mark: 'bar', data: { values: [{ a: 1 }] }, encoding: { y: { field: 'a', type: 'quantitative' } } }

describe('compare', () => {
  test('each option becomes one titled, sized view of a shared-scale hconcat', async () => {
    const spec = combinedSpec(
      [
        { index: 1, label: 'local', spec: BAR },
        { index: 3, label: 'Redis', spec: BAR },
      ],
      800,
      176,
    )
    expect(spec.resolve).toEqual({ scale: { x: 'shared', y: 'shared', color: 'shared' } })
    expect(spec.hconcat).toEqual([
      { ...BAR, title: '1. local', width: 344, height: 118 },
      { ...BAR, title: '3. Redis', width: 344, height: 118 },
    ])
  })

  test("the model's own size, title, schema and config never reach a view", async () => {
    const spec = combinedSpec(
      [{ index: 1, label: 'x', spec: { ...BAR, $schema: 'https://x', config: { background: 'red' }, width: 999, height: 999, title: 'mine' } }],
      400,
      176,
    )
    expect(spec.hconcat).toEqual([{ ...BAR, title: '1. x', width: 344, height: 118 }])
  })

  test('a very narrow or very short box still gets a drawable size', async () => {
    const spec = combinedSpec([{ index: 1, label: 'x', spec: BAR }, { index: 2, label: 'y', spec: BAR }], 100, 50)
    expect(spec.hconcat).toEqual([
      { ...BAR, title: '1. x', width: 60, height: 40 },
      { ...BAR, title: '2. y', width: 60, height: 40 },
    ])
  })
})
