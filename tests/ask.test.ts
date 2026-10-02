import { describe, expect, test } from 'claude-code/testing'

import {
  answerFreely,
  confirm,
  hasDrawings,
  isOnOther,
  isSafeId,
  linesOf,
  outcomeOf,
  pressOption,
  showOption,
  showOther,
  startAsk,
  type AskState,
  type Question,
  type Step,
} from '../hooks/ask'

const fence = '```mermaid\nflowchart LR\n  A --> B\n```'
const single: Question = {
  question: 'Quelle archi ?',
  header: 'Archi',
  multiSelect: false,
  options: [
    { label: 'Monolithe', description: 'un service', preview: fence },
    { label: 'Workers', description: 'une file', preview: fence },
  ],
}
const multi: Question = {
  question: 'Quelles phases ?',
  header: 'Phases',
  multiSelect: true,
  options: [
    { label: 'Lint', description: 'a' },
    { label: 'Tests', description: 'b' },
    { label: 'Review', description: 'c' },
  ],
}

function stateOf(step: Step): AskState {
  if (!('state' in step)) throw new Error(`attendu un état, reçu ${JSON.stringify(step)}`)
  return step.state
}

describe('ask', () => {
  test('a preview with a chart or a diagram is a drawing, plain text is not', () => {
    expect(hasDrawings([single])).toBe(true)
    expect(hasDrawings([multi])).toBe(false)
    expect(hasDrawings([{ ...multi, options: [{ label: 'a', description: 'b', preview: '```ts\nconst a = 1\n```' }] }])).toBe(false)
  })

  test('single choice: a digit shows the option, the same digit again picks it', () => {
    const shown = stateOf(pressOption(startAsk([single]), 1))
    expect(shown.focus).toBe(1)
    expect(pressOption(shown, 1)).toEqual({ answers: { 'Quelle archi ?': 'Workers' } })
  })

  test('multiple choice: digits toggle, confirm joins the picks in option order', () => {
    let state = stateOf(pressOption(startAsk([multi]), 2))
    state = stateOf(pressOption(state, 0))
    state = stateOf(pressOption(state, 1))
    state = stateOf(pressOption(state, 1))
    expect(state.picked).toEqual([2, 0])
    expect(confirm(state)).toEqual({ answers: { 'Quelles phases ?': 'Lint, Review' } })
  })

  test('multiple choice confirmed with nothing ticked answers the option on screen', () => {
    const state = stateOf(pressOption(stateOf(pressOption(startAsk([multi]), 1)), 1))
    expect(state.picked).toEqual([])
    expect(confirm(state)).toEqual({ answers: { 'Quelles phases ?': 'Tests' } })
  })

  test('several questions are asked one after the other, answers kept', () => {
    const second = stateOf(confirm(startAsk([single, multi])))
    expect(second).toMatchObject({ index: 1, focus: 0, picked: [], answers: { 'Quelle archi ?': 'Monolithe' } })
    expect(confirm(stateOf(pressOption(second, 2)))).toEqual({
      answers: { 'Quelle archi ?': 'Monolithe', 'Quelles phases ?': 'Review' },
    })
  })

  test('the arrows show an option without picking it; past the options, nothing moves', () => {
    const state = startAsk([single])
    expect(showOption(state, 1)).toEqual({ ...state, focus: 1 })
    expect(showOption(state, 0)).toBe(state)
    expect(showOption(state, 5)).toBe(state)
  })

  test('on Autre, nothing is shown and Valider waits for the field; ticked options still go', () => {
    const other = showOther(startAsk([single]))
    expect(other.focus).toBe(2)
    expect(isOnOther(other)).toBe(true)
    expect(confirm(other)).toEqual({ state: other })
    const ticked = showOther(stateOf(pressOption(startAsk([multi]), 1)))
    expect(confirm(ticked)).toEqual({ answers: { 'Quelles phases ?': 'Tests' } })
  })

  test('a free answer is trimmed and answers the question; a blank one does nothing', () => {
    const state = startAsk([single])
    expect(answerFreely(state, '  un monolithe modulaire ')).toEqual({ answers: { 'Quelle archi ?': 'un monolithe modulaire' } })
    expect(answerFreely(state, '   ')).toEqual({ state })
  })

  test('only a plain tool_use_id can name the answer file', () => {
    expect(isSafeId('toolu_01AbC-9')).toBe(true)
    expect(isSafeId('../../etc/passwd')).toBe(false)
    expect(isSafeId('a/b')).toBe(false)
    expect(isSafeId('')).toBe(false)
  })

  test('linesOf folds word by word like the terminal, and cuts a word longer than the line', () => {
    expect(linesOf('', 10)).toBe(1)
    expect(linesOf('un deux trois', 13)).toBe(1)
    expect(linesOf('un deux trois', 12)).toBe(2)
    expect(linesOf('a\nb', 10)).toBe(2)
    expect(linesOf('abcdefghijkl', 5)).toBe(3)
    expect(linesOf('é è à', 5)).toBe(1)
  })

  test('a digit past the options changes nothing', () => {
    const state = startAsk([single])
    expect(pressOption(state, 3)).toEqual({ state })
  })

  test('the outcome written by the pane is read back, anything else is refused', () => {
    expect(outcomeOf('{"answers":{"Q ?":"A"}}')).toEqual({ answers: { 'Q ?': 'A' } })
    expect(outcomeOf('{"cancel":true}')).toEqual({ cancel: true })
    expect(outcomeOf('{"classic":true}')).toEqual({ classic: true })
    expect(outcomeOf('')).toBeNull()
    expect(outcomeOf('{"answers":{"Q ?":3}}')).toBeNull()
    expect(outcomeOf('[1]')).toBeNull()
  })
})
