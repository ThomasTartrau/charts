// La question posée dans la bande au-dessus du prompt, à la place du dialogue
// AskUserQuestion, quand un aperçu est un graphique ou un schéma : son état, sans moteur ni rendu.
import { chartBlocksOf, withoutCharts, type ChartBlock } from './fences'

export type Option = { label: string; description: string; preview?: string }
export type Question = { question: string; header: string; options: Option[]; multiSelect: boolean }
export type Answers = Record<string, string>
/** Ce que le panneau rend à l'appel de l'outil : des réponses, une annulation, ou le dialogue du moteur. */
export type Outcome = { answers: Answers } | { cancel: true } | { classic: true }

/** Un tool_use_id sert de nom de fichier : rien d'autre que lettres, chiffres, `_` et `-`. */
export const isSafeId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id)

export type AskState = {
  questions: Question[]
  /** la question affichée */
  index: number
  /** l'option dont l'aperçu est affiché, 0 pour la première */
  focus: number
  /** les options cochées de la question affichée (multiSelect) */
  picked: number[]
  answers: Answers
}

export type Step = { state: AskState } | { answers: Answers }

export function questionsOf(value: unknown): Question[] | null {
  if (!Array.isArray(value)) return null
  const ok = value.every(q => typeof q === 'object' && q !== null && Array.isArray(Reflect.get(q, 'options')))
  return ok ? (value as Question[]) : null
}

/** Vrai quand au moins un aperçu contient un bloc à dessiner (vega-lite, mermaid, dot). */
export function hasDrawings(questions: readonly Question[]): boolean {
  return questions.some(q => q.options.some(o => !!o.preview && chartBlocksOf(o.preview).length > 0))
}

// Repli sur le dialogue du moteur (pas de bande) : les graphiques vega-lite des
// aperçus sont dessinés au-dessus de lui, et retirés de ses aperçus texte.

const PREVIEW_NOTE = '(graphique affiché au-dessus de la question)'

export type Asked = { header: string; charts: { index: number; label: string; block: ChartBlock }[] }

/** Les aperçus vega-lite de la première question qui en a, ou null. */
export function askedOf(questions: readonly Question[]): Asked | null {
  for (const q of questions) {
    const charts = q.options.flatMap((o, i) => {
      const block = o.preview ? chartBlocksOf(o.preview).find(b => b.kind === 'vega-lite') : undefined
      return block ? [{ index: i + 1, label: o.label, block }] : []
    })
    if (charts.length > 0) return { header: q.header, charts }
  }
  return null
}

export function withoutPreviewCharts(questions: readonly Question[]): Question[] {
  return questions.map(q => ({
    ...q,
    options: q.options.map(o => (o.preview ? { ...o, preview: withoutCharts(o.preview, PREVIEW_NOTE) } : o)),
  }))
}

/**
 * Lignes qu'occupe `text` replié mot à mot sur `width` colonnes, comme `wrap="wrap"`.
 * La bande doit tenir en entier : plus haute, le moteur la fait défiler et les
 * flèches défilent au lieu de passer d'une option à l'autre.
 */
export function linesOf(text: string, width: number): number {
  const columns = Math.max(1, width)
  return text.split('\n').reduce((sum, line) => {
    let lines = 1
    let used = 0
    for (const word of line.split(/\s+/).filter(Boolean)) {
      const length = [...word].length
      if (used === 0) used = length
      else if (used + 1 + length <= columns) used += 1 + length
      else {
        lines++
        used = length
      }
      // un mot plus long que la ligne est coupé
      while (used > columns) {
        lines++
        used -= columns
      }
    }
    return sum + lines
  }, 0)
}

export function startAsk(questions: Question[]): AskState {
  return { questions, index: 0, focus: 0, picked: [], answers: {} }
}

/**
 * Le chiffre d'une option : il montre son aperçu ; en choix unique, le même
 * chiffre une seconde fois la choisit ; en choix multiple, il la coche ou la décoche.
 */
export function pressOption(state: AskState, option: number): Step {
  const question = state.questions[state.index]
  if (!question || option < 0 || option >= question.options.length) return { state }
  if (question.multiSelect) {
    const picked = state.picked.includes(option) ? state.picked.filter(i => i !== option) : [...state.picked, option]
    return { state: { ...state, focus: option, picked } }
  }
  return option === state.focus ? confirm(state) : { state: { ...state, focus: option } }
}

/** Les flèches posent le focus sur une option : son aperçu s'affiche, rien n'est choisi. */
export function showOption(state: AskState, option: number): AskState {
  const question = state.questions[state.index]
  if (!question || option < 0 || option >= question.options.length || option === state.focus) return state
  return { ...state, focus: option }
}

/** Le focus sur le champ « Autre » : aucune option n'est affichée, aucun aperçu. */
export function showOther(state: AskState): AskState {
  const question = state.questions[state.index]
  return question && state.focus !== question.options.length ? { ...state, focus: question.options.length } : state
}

/** Vrai quand le focus est sur le champ « Autre » plutôt que sur une option. */
export function isOnOther(state: AskState): boolean {
  return state.focus >= (state.questions[state.index]?.options.length ?? 0)
}

/** Valide la question affichée : l'option affichée, ou les cochées ; puis la suivante, ou les réponses. */
export function confirm(state: AskState): Step {
  const question = state.questions[state.index]
  if (!question) return { answers: state.answers }
  // sur « Autre », c'est le champ qui répond, avec son propre Entrée
  if (isOnOther(state) && (!question.multiSelect || state.picked.length === 0)) return { state }
  const chosen = question.multiSelect && state.picked.length > 0 ? state.picked.toSorted((a, b) => a - b) : [state.focus]
  return answer(state, chosen.map(i => question.options[i]?.label ?? '').join(', '))
}

/** Le champ « Autre » : le texte tapé répond à la question affichée ; vide, il ne fait rien. */
export function answerFreely(state: AskState, text: string): Step {
  return text.trim() ? answer(state, text.trim()) : { state }
}

function answer(state: AskState, text: string): Step {
  const question = state.questions[state.index]
  if (!question) return { answers: state.answers }
  const answers = { ...state.answers, [question.question]: text }
  if (state.index + 1 >= state.questions.length) return { answers }
  return { state: { ...state, index: state.index + 1, focus: 0, picked: [], answers } }
}

/** Relit ce que le panneau a écrit pour l'appel en attente ; null quand ce n'en est pas. */
export function outcomeOf(text: string): Outcome | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  if (Reflect.get(value, 'cancel') === true) return { cancel: true }
  if (Reflect.get(value, 'classic') === true) return { classic: true }
  const answers: unknown = Reflect.get(value, 'answers')
  if (typeof answers !== 'object' || answers === null) return null
  const entries = Object.entries(answers)
  return entries.every(([, v]) => typeof v === 'string') ? { answers: Object.fromEntries(entries) as Answers } : null
}
