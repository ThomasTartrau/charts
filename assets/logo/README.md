# charts logo

A code fence whose third backtick has been rendered as a picture. The name is always lowercase: `charts`.

The two ticks are the source, which stays in the message; the cobalt square is the image drawn from it.

## Files

| File | What it is |
|---|---|
| `charts-logo-light.svg` | Horizontal logo for light backgrounds (ink ticks and wordmark, cobalt square) |
| `charts-logo-dark.svg` | Horizontal logo for dark backgrounds (paper ticks and wordmark, cobalt square) |
| `charts-logo-black.svg` | One-colour logo, ink only (print, stamps, single-colour contexts) |
| `charts-logo-white.svg` | One-colour logo, white only, for photos and coloured backgrounds |
| `charts-symbol-light.svg` | Symbol alone for light backgrounds |
| `charts-symbol-dark.svg` | Symbol alone for dark backgrounds |
| `charts-symbol-black.svg` | Symbol alone, ink only |
| `charts-icon.svg` | Square icon: symbol on a rounded ink tile (200 x 200 viewBox, 180 tile, radius 40) |
| `charts-icon-180.png`, `-192.png`, `-512.png` | The icon as PNG (Apple touch icon, web manifest, stores) |
| `favicon.svg`, `favicon.ico` | Small-size cut: tighter tile, larger symbol; the `.ico` holds 16, 32 and 48 px |
| `charts-avatar.png` | 512 x 512 avatar: symbol on a full ink square, safe for circular crops |
| `charts-banner.png` | 2560 x 640 banner with its own dark background, readable on any theme |
| `charts-social.png` | 1280 x 640 card: ` ```vega-lite `, logo, "Read charts, not JSON." |
| `charts-header-light.png` | Header of the `/charts` output on a light terminal (transparent, 96 px high, 2x) |
| `charts-header-dark.png` | Header of the `/charts` output on a dark terminal (transparent, 96 px high, 2x) |

Every SVG is plain filled paths: no strokes, no live text, no filters. The wordmark is drawn, not set
in a font, so there is no font licence to track. Only `charts-social.png` uses a font, JetBrains Mono,
for its two lines of text.

## What to use where

### README

GitHub picks the light or dark SVG from the viewer's theme. GitLab strips `<picture>` and `<source>`,
so it shows the `<img>` fallback, the banner, which reads on both GitLab themes.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo/charts-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/logo/charts-logo-light.svg">
  <img alt="charts" src="assets/logo/charts-banner.png" width="520">
</picture>
```

### Plugin marketplace page

- Plugin icon: `charts-icon.svg`, or `charts-icon-512.png` where only raster is accepted.
- Header or cover image: `charts-banner.png`.

### `/charts` command output

Show `charts-header-dark.png` on a dark terminal background and `charts-header-light.png` on a light
one. Both are transparent, so they sit on the terminal colour. At 96 px they are drawn for 2x screens;
display them at 48 px high.

### Website and favicon

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/charts-icon-180.png">
```

### Social

- GitHub: Settings > General > Social preview, `charts-social.png`. It also shows in link previews on
  LinkedIn, Slack and X.
- LinkedIn post or project section: `charts-social.png` as the media.
- GitLab project avatar: `charts-avatar.png` (Settings > General > Project avatar).
- Any dedicated account avatar: `charts-avatar.png`.

## Colours

| Name | HEX | RGB | Use |
|---|---|---|---|
| Cobalt | `#3D63F5` | 61 99 245 | The square only |
| Ink | `#0E0F12` | 14 15 18 | Ticks and wordmark on light backgrounds, dark tiles |
| Paper | `#F4F3EF` | 244 243 239 | Ticks and wordmark on dark backgrounds |

Cobalt holds a contrast of 4.9:1 on white, 4.4:1 on paper and 3.9:1 on ink, so the square stays
visible on light and dark terminals alike.

## Rules

- Keep clear space around the logo at least as wide as one tick.
- Minimum size: symbol 16 px wide (use `favicon.svg` below 32 px), horizontal logo 96 px wide.
- Only the square takes the colour. The ticks always match the wordmark.
- Don't stretch, rotate, recolour the ticks, add effects, retype the wordmark in a font, change the
  slant of the ticks, or put the square before them.
