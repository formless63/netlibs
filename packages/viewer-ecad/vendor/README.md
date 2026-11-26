# Vendored ECAD assets

| File | Upstream | Licence |
| --- | --- | --- |
| `kicanvas.js` | https://kicanvas.org/kicanvas/kicanvas.js (built from theacodes/kicanvas `b031159`, 2026-04-28), upstream sha256 `ca910f25…865ab7` | MIT, see `LICENSE.md` (also covers the Earcut, Newstroke, Nunito and Bellota notices) |
| `material-symbols.js` | Google Fonts, Material Symbols Outlined, subset to the icons KiCanvas uses | Apache-2.0, see `LICENSE-material-symbols.txt` |

KiCanvas publishes no npm package, which is the only reason it is vendored. Two
changes are made to it:

1. The final statement, which injected a Google Fonts stylesheet into the host
   page, is removed.
2. The icon template sets its SVG `href` directly. Upstream's leaves a literal
   placeholder there for a moment, so every mount sends a stray request for
   `$$:0:$$` to the host.

Regenerate with
`bun run vendor:kicanvas`; the script refuses a bundle whose hash changed.
