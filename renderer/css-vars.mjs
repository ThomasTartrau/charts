// beautiful-mermaid colore ses SVG avec des variables CSS et color-mix(), que
// resvg ne sait pas lire. On calcule chaque variable une fois, puis on remplace
// tous les var(...) du document par la couleur résolue.

/** Position de la parenthèse fermante qui répond à celle ouverte en `open`. */
function closingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Découpe sur les virgules de premier niveau, hors parenthèses. */
function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') depth -= 1
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h.slice(0, 6)
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(rgb) {
  return `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/** color-mix(in srgb, A p%, B) ; une couleur non hexadécimale laisse le mélange tel quel. */
function mix(args) {
  const [space, first, second] = splitTopLevel(args)
  if (!space?.startsWith('in srgb') || !first || !second) return null
  const match = /^(.*?)\s+([\d.]+)%$/.exec(first)
  const colorA = match ? match[1] : first
  const share = match ? Number(match[2]) / 100 : 0.5
  const a = hexToRgb(colorA)
  const b = hexToRgb(second)
  if (!a || !b) return null
  return rgbToHex(a.map((v, i) => v * share + b[i] * (1 - share)))
}

/** Résout var() et color-mix() dans `value`, avec les définitions de `vars`. */
function resolveValue(value, vars, depth = 0) {
  if (depth > 20) return value
  let out = ''
  let i = 0
  while (i < value.length) {
    const isVar = value.startsWith('var(', i)
    const isMix = value.startsWith('color-mix(', i)
    if (!isVar && !isMix) {
      out += value[i]
      i += 1
      continue
    }
    const open = value.indexOf('(', i)
    const close = closingParen(value, open)
    if (close === -1) return out + value.slice(i)
    const inner = value.slice(open + 1, close)
    if (isVar) {
      const [name, ...rest] = splitTopLevel(inner)
      const fallback = rest.join(', ')
      const defined = vars.get(name)
      const chosen = defined !== undefined ? defined : fallback
      out += resolveValue(chosen, vars, depth + 1)
    } else {
      const resolvedArgs = resolveValue(inner, vars, depth + 1)
      out += mix(resolvedArgs) ?? `color-mix(${resolvedArgs})`
    }
    i = close + 1
  }
  return out
}

export function resolveCssVars(svg) {
  const vars = new Map()
  // définitions : style="--bg:#...;" sur <svg>, puis les --_x: ...; du bloc <style>
  for (const [, name, value] of svg.matchAll(/(--[\w-]+)\s*:\s*([^;"}]+)/g)) {
    if (!vars.has(name)) vars.set(name, value.trim())
  }
  return resolveValue(svg.replace(/@import url\([^)]*\);?/g, ''), vars)
}
