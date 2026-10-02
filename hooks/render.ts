// Appel du moteur de rendu (renderer/render.mjs, un process node) et calcul de
// la taille en cellules. Le module de hooks n'a ni Node ni DOM : vega tourne
// dans ce process séparé, qui écrit le PNG que le terminal lit lui-même.
import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

/** `$.process.run`, passé depuis register.tsx ($ ne traverse pas les imports). */
export type Run = (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>

export type Theme = 'dark' | 'light'
export type Format = 'png' | 'svg'

export type Rendered =
  | { ok: true; file?: string; svg?: string; width: number; height: number }
  | { ok: false; error: string; isTransient?: boolean }

/** Pixels CSS dessinés par colonne de terminal ; le PNG est rendu en x2. */
export const PX_PER_COLUMN = 8

const NODES = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node']
/** macOS, puis Linux */
const OPENERS = ['/usr/bin/open', 'xdg-open']
const MEMO_SIZE = 64
const memo = new Map<string, Promise<Rendered>>()

export function chartColumns(viewportColumns: number | undefined, maxColumns: number, indent: number): number {
  const available = (viewportColumns ?? 100) - indent - 2
  return Math.max(20, Math.min(maxColumns, available, 255))
}

/** Hauteur maximale en pixels CSS pour tenir dans `maxRows` lignes de terminal. */
export function maxHeightFor(maxRows: number, cellAspect: number): number {
  return Math.round((maxRows * PX_PER_COLUMN) / cellAspect)
}

/** Lignes de terminal pour garder le ratio du PNG (cellAspect = largeur / hauteur d'une cellule). */
export function chartRows(columns: number, width: number, height: number, cellAspect: number): number {
  const rows = Math.round((columns * cellAspect * height) / width)
  return Math.max(3, Math.min(rows, 255))
}

function isRendered(value: unknown): value is Rendered {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'ok') === 'boolean'
}

async function runRenderer(run: Run, root: string, input: string): Promise<Rendered> {
  const script = `${root}/renderer/render.mjs`
  let lastError = 'node introuvable'
  for (const node of NODES) {
    const attempt = await run([node, script], { stdin: input, timeoutMs: 20_000 }).then(
      ran => ({ ran }),
      (error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) }),
    )
    if ('failed' in attempt) {
      // Seul un binaire absent fait essayer le suivant. Un rendu abandonné (zoom :
      // le moteur tue le process) ou trop long n'a rien à voir avec ce binaire.
      if (!attempt.failed.includes('failed to start')) return { ok: false, error: attempt.failed, isTransient: true }
      lastError = attempt.failed
      continue
    }
    const { ran } = attempt
    if (ran.exitCode !== 0 && ran.stdout.trim() === '') {
      return { ok: false, error: ran.stderr.trim().slice(0, 300) || `exit ${ran.exitCode}` }
    }
    try {
      const parsed: unknown = JSON.parse(ran.stdout)
      return isRendered(parsed) ? parsed : { ok: false, error: 'réponse du renderer illisible' }
    } catch {
      return { ok: false, error: `sortie du renderer illisible : ${ran.stdout.slice(0, 120)}` }
    }
  }
  return { ok: false, error: lastError }
}

/** Ce que le renderer dessine : une spec vega-lite, ou la source texte d'un schéma. */
export type Drawing = { kind: 'vega-lite'; spec: Record<string, unknown> } | { kind: 'mermaid' | 'dot'; source: string }

export function renderChart(
  run: Run,
  root: string,
  drawing: Drawing,
  options: { width: number; maxHeight: number; theme: Theme; format: Format; scale?: number; opaque?: boolean },
): Promise<Rendered> {
  const input = JSON.stringify({ ...drawing, ...options })
  const cached = memo.get(input)
  if (cached) {
    // remis en fin de file : les graphiques encore affichés restent en mémoire
    memo.delete(input)
    memo.set(input, cached)
    // l'échec passager d'un autre rendu (abandonné pendant un zoom) ne vaut pas pour celui-ci : une relance
    return cached.then(rendered => {
      if (rendered.ok || !rendered.isTransient) return rendered
      const fresh = memo.get(input)
      return fresh && fresh !== cached ? fresh : startRender(run, root, input)
    })
  }
  return startRender(run, root, input)
}

function startRender(run: Run, root: string, input: string): Promise<Rendered> {
  const pending = runRenderer(run, root, input)
  // le cache disque du renderer prend le relais : on ne garde que les plus récents (SVG lourds)
  if (memo.size >= MEMO_SIZE) memo.delete(memo.keys().next().value!)
  memo.set(input, pending)
  // un échec passager n'est pas gardé : le rendu suivant relance node
  void pending.then(rendered => {
    if (!rendered.ok && rendered.isTransient && memo.get(input) === pending) memo.delete(input)
  })
  return pending
}

/**
 * « Ouvrir en grand » : un graphique sur 1400 px, un schéma à sa taille naturelle, en x2
 * et sur fond plein (la visionneuse n'a pas le fond du terminal), ouvert par le système.
 * Rend l'erreur à montrer, ou null.
 */
export async function openInViewer(run: Run, root: string, drawing: Drawing, theme: Theme): Promise<string | null> {
  const size = drawing.kind === 'vega-lite' ? { width: 1400, maxHeight: 900 } : { width: 8000, maxHeight: 8000 }
  const rendered = await renderChart(run, root, drawing, { ...size, theme, format: 'png', scale: 2, opaque: true })
  if (!rendered.ok) return rendered.error
  if (!rendered.file) return "le renderer n'a pas écrit de PNG"
  for (const opener of OPENERS) {
    // rejeté : ce binaire n'existe pas ici, on essaie le suivant
    const ran = await run([opener, rendered.file], { timeoutMs: 10_000 }).catch(() => null)
    if (ran) return ran.exitCode === 0 ? null : ran.stderr.trim() || `${opener} : exit ${ran.exitCode}`
  }
  return `ni ${OPENERS.join(' ni ')} ne démarre`
}

export function clearMemo(): void {
  memo.clear()
}
