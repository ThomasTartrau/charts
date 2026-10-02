// Les camemberts (pie) et les diagrammes de Gantt mermaid, que beautiful-mermaid ne
// dessine pas, traduits en specs vega-lite : même renderer et même thème que les graphiques.
import type { ParsedSpec } from './fences'

const SCHEMA = 'https://vega.github.io/schema/vega-lite/v6.json'
/** la palette a 8 couleurs, jamais recyclées : au-delà, les plus petites parts sont regroupées */
const MAX_SLICES = 8
const PIE_PX = 220
const GANTT_ROW_PX = 24
/** l'axe des dates sous les barres, et la place d'un titre ou d'une légende au-dessus */
const GANTT_AXIS_PX = 30
const GANTT_BAND_PX = 30

const SLICE = /^"([^"]+)"\s*:\s*(\d+(?:\.\d+)?)$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/
const DAY_MS = 864e5
const UNIT_MS: Record<string, number> = { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: DAY_MS, w: 7 * DAY_MS }
const TAGS = new Set(['done', 'active', 'crit', 'milestone'])
// réglages mermaid sans effet ici : les dates sont lues en YYYY-MM-DD [HH:mm], sans jours exclus
const IGNORED = /^(dateFormat|excludes|includes|todayMarker|tickInterval|weekday|weekend|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr|click)\b/

type Task = { name: string; section: string; start: number; end: number; tags: string[] }
type Found = { at: number } | { error: string }

/** Un camembert ou un gantt traduit, son erreur, ou null pour les autres types mermaid. */
export function mermaidChart(source: string): ParsedSpec | null {
  const lines = source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('%%'))
  const [first = '', ...rest] = lines
  const type = first.split(/\s/)[0]
  if (type === 'pie') return pieSpec(first.slice(3).trim(), rest)
  if (type === 'gantt') return ganttSpec(rest)
  return null
}

function pieSpec(header: string, lines: readonly string[]): ParsedSpec {
  let title: string | undefined
  let showData = false
  const slices: { name: string; value: number }[] = []
  // l'en-tête peut porter showData et le titre : `pie showData title Animaux`
  for (const raw of [header, ...lines]) {
    let line = raw
    if (/^showData\b/.test(line)) {
      showData = true
      line = line.slice('showData'.length).trim()
    }
    if (line === '' || /^acc(Title|Descr)\b/.test(line)) continue
    const titled = /^title\s+(.+)$/.exec(line)
    if (titled) {
      title = titled[1]
      continue
    }
    const slice = SLICE.exec(line)
    if (!slice) return { error: `pie : ligne illisible : ${line}` }
    slices.push({ name: slice[1]!, value: Number(slice[2]) })
  }
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0) return { error: 'pie : aucune part non nulle' }

  const sorted = slices.toSorted((a, b) => b.value - a.value)
  const kept =
    sorted.length <= MAX_SLICES
      ? sorted
      : [...sorted.slice(0, MAX_SLICES - 1), { name: 'Autres', value: sorted.slice(MAX_SLICES - 1).reduce((sum, s) => sum + s.value, 0) }]
  const values = kept.map((s, rank) => {
    const share = (s.value / total) * 100
    const percent = share > 0 && share < 1 ? '<1 %' : `${Math.round(share)} %`
    return { rank, value: s.value, label: showData ? `${s.name}  ${s.value} (${percent})` : `${s.name}  ${percent}` }
  })
  return {
    spec: {
      $schema: SCHEMA,
      ...(title ? { title } : {}),
      description: title ?? 'camembert',
      width: PIE_PX,
      height: PIE_PX,
      data: { values },
      mark: { type: 'arc', padAngle: 0.012 },
      encoding: {
        theta: { field: 'value', type: 'quantitative', stack: true },
        order: { field: 'rank', type: 'quantitative' },
        color: { field: 'label', type: 'nominal', sort: null, legend: { title: null, orient: 'right', direction: 'vertical', labelLimit: 400 } },
      },
    },
  }
}

function ganttSpec(lines: readonly string[]): ParsedSpec {
  let title: string | undefined
  let axisFormat: string | undefined
  let section = ''
  const tasks: Task[] = []
  const byId = new Map<string, Task>()
  for (const line of lines) {
    const directive = /^(title|axisFormat|section)\s+(.+)$/.exec(line)
    if (directive) {
      const value = directive[2]!
      if (directive[1] === 'title') title = value
      else if (directive[1] === 'axisFormat') axisFormat = value
      else section = value
      continue
    }
    if (IGNORED.test(line)) continue
    const colon = line.indexOf(':')
    if (colon <= 0) return { error: `gantt : ligne illisible : ${line}` }
    const name = line.slice(0, colon).trim()
    const read = taskOf(name, line.slice(colon + 1), section, tasks.at(-1), byId)
    if ('error' in read) return { error: `gantt : "${name}" : ${read.error}` }
    tasks.push(read.task)
    if (read.id) byId.set(read.id, read.task)
  }
  if (tasks.length === 0) return { error: 'gantt : aucune tâche' }

  const sections = [...new Set(tasks.map(t => t.section))]
  const values = tasks.map(t => ({
    task: t.tags.includes('crit') ? `${t.name} (critique)` : t.name,
    section: t.section || 'tâches',
    start: new Date(t.start).toISOString(),
    end: new Date(t.end).toISOString(),
    isDone: t.tags.includes('done'),
    isMilestone: t.tags.includes('milestone'),
  }))
  // l'heure mermaid est celle écrite : échelle UTC, sinon le fuseau décale les jours
  // sans axisFormat, vega écrit les dates en anglais (Fri 02, Oct 04) : jour/mois, et l'heure s'il y en a
  const hasTimes = tasks.some(t => t.start % DAY_MS !== 0 || t.end % DAY_MS !== 0)
  const format = axisFormat ?? (hasTimes ? '%d/%m %Hh%M' : '%d/%m')
  const x = { field: 'start', type: 'temporal', scale: { type: 'utc' }, axis: { title: null, format } }
  const hasSections = sections.length > 1 || sections[0] !== ''
  return {
    spec: {
      $schema: SCHEMA,
      ...(title ? { title } : {}),
      description: title ?? 'diagramme de Gantt',
      // le renderer fait tenir le tout (titre, légende, axe) dans la hauteur : on les ajoute aux lignes
      height: tasks.length * GANTT_ROW_PX + GANTT_AXIS_PX + (title ? GANTT_BAND_PX : 0) + (hasSections ? GANTT_BAND_PX : 0),
      data: { values },
      encoding: {
        // l'ordre écrit, jalons compris : les deux couches ne le gardent pas seules
        y: { field: 'task', type: 'nominal', sort: [...new Set(values.map(v => v.task))], axis: { title: null, labelOverlap: false, labelLimit: 240 } },
        ...(hasSections ? { color: { field: 'section', type: 'nominal', sort: sections.map(s => s || 'tâches'), legend: { title: null } } } : {}),
      },
      layer: [
        {
          transform: [{ filter: '!datum.isMilestone' }],
          mark: { type: 'bar', cornerRadius: 3 },
          encoding: { x, x2: { field: 'end' }, opacity: { condition: { test: 'datum.isDone', value: 0.4 }, value: 1 } },
        },
        {
          transform: [{ filter: 'datum.isMilestone' }],
          mark: { type: 'point', shape: 'diamond', filled: true, size: 140, opacity: 1 },
          encoding: { x },
        },
      ],
    },
  }
}

/**
 * `nom : [tags,] [id,] [début,] fin` : la fin est une date, une durée (3d) ou
 * `until id` ; sans début, la tâche suit la précédente ; un début peut être `after id`.
 */
function taskOf(
  name: string,
  meta: string,
  section: string,
  previous: Task | undefined,
  byId: ReadonlyMap<string, Task>,
): { task: Task; id?: string } | { error: string } {
  const items = meta
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '')
  const firstPlain = items.findIndex(item => !TAGS.has(item))
  const tags = firstPlain === -1 ? items : items.slice(0, firstPlain)
  const rest = firstPlain === -1 ? [] : items.slice(firstPlain)
  if (rest.length === 0 || rest.length > 3) return { error: 'il faut une fin ou une durée, et au plus id, début, fin' }

  let id: string | undefined
  let startText: string | undefined
  if (rest.length === 3) [id, startText] = rest
  else if (rest.length === 2) {
    const head = rest[0]!
    // une date impossible (2026-02-31) reste un début : son erreur le dira
    if (head.startsWith('after ') || DATE.test(head)) startText = head
    else id = head
  }
  const start: Found = startText !== undefined ? startOf(startText, byId) : previous ? { at: previous.end } : { error: 'ni date de début ni tâche avant' }
  if ('error' in start) return start
  const end = tags.includes('milestone') ? start : endOf(rest.at(-1)!, start.at, byId)
  if ('error' in end) return end
  return { task: { name, section, start: start.at, end: end.at, tags }, ...(id ? { id } : {}) }
}

function startOf(text: string, byId: ReadonlyMap<string, Task>): Found {
  const after = /^after\s+(.+)$/.exec(text)
  if (after) {
    const ends = after[1]!.split(/\s+/).map(id => byId.get(id)?.end)
    const known = ends.filter((end): end is number => end !== undefined)
    return known.length === ends.length ? { at: Math.max(...known) } : { error: `tâche inconnue dans "${text}"` }
  }
  const at = dateOf(text)
  return at === null ? { error: `date illisible "${text}" (format YYYY-MM-DD ou YYYY-MM-DD HH:mm)` } : { at }
}

function endOf(text: string, start: number, byId: ReadonlyMap<string, Task>): Found {
  const duration = DURATION.exec(text)
  if (duration) return { at: start + Number(duration[1]) * UNIT_MS[duration[2]!]! }
  const until = /^until\s+(\S+)$/.exec(text)
  if (until) {
    const task = byId.get(until[1]!)
    return task ? { at: task.start } : { error: `tâche inconnue dans "${text}"` }
  }
  const at = dateOf(text)
  if (at === null) return { error: `fin illisible "${text}" (date YYYY-MM-DD ou durée : 3d, 2w, 4h)` }
  return at < start ? { error: `la fin "${text}" est avant le début` } : { at }
}

function dateOf(text: string): number | null {
  const m = DATE.exec(text)
  if (!m) return null
  const day = Number(m[3])
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, day, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0))
  // 2026-02-31 : Date.UTC déborde sur mars, la date est refusée
  return new Date(at).getUTCDate() === day ? at : null
}
