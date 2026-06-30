# Rich highlight — research notes (for the material rebuild)

Goal: not to clone Apple Liquid Glass, but to hit that level of richness for MagPoint's own
"magnetically-pulled metallic liquid" identity. The Phase-0 canvas gradient reads as a flat
blob because it skips the four layers that actually sell glass/metal.

## The four layers that make it read as a material
1. **Backdrop refraction (frost):** `backdrop-filter: blur(2–12px) saturate(180%) brightness(1.1)`, tint = near-transparent `rgba(255,255,255,.12)` over the blurred backdrop — never an opaque gradient fill.
2. **Lensing (the missing part):** an SVG `feDisplacementMap` that warps the backdrop through a precomputed displacement map. This is what makes it a lens, not a frosted card.
3. **Specular rim + layered highlights:** inset box-shadows (`inset 0 1px 0 rgba(255,255,255,.5)` lit lip + hairline rim) + soft outer depth shadow. Cheaper than `feSpecularLighting` and usually enough.
4. **Adaptivity / depth:** lensing scales up with element size (Apple's intent).

## SVG displacement filter chain (Chromium-only — fine for our extension)
```xml
<filter id="liquid-glass" color-interpolation-filters="sRGB">
  <feImage href="data:image/png;..." result="map"/>            <!-- R=x-disp, G=y-disp -->
  <feDisplacementMap in="SourceGraphic" in2="map" scale="50"
       xChannelSelector="R" yChannelSelector="G" result="refracted"/>
  <feGaussianBlur in="refracted" stdDeviation="1" result="blurred"/>
  <feColorMatrix in="blurred" type="saturate" values="1.5" result="tinted"/>
  <feComposite in="tinted" in2="SourceGraphic" operator="atop"/>
</filter>
```
Apply via `backdrop-filter: url(#liquid-glass) brightness(1.1)`.
- `scale` is THE artistic knob: ~40–60 subtle UI rim, 100+ heavy lens. Channels R/G universal. Displacement encodes −128…127 px.
- **Map generation (build once, data-URL):** sample refraction along one radius (127 samples), Snell's law through a height profile, normalize, encode `r=128+x*127, g=128+y*127, b=128, a=255`. Convex squircle height `y = ⁴√(1−(1−x)⁴)` is closest to Apple.
- Optional chromatic aberration: 3 `feDisplacementMap` passes, per-channel scale offsets ~`[0,10,20]`, recombine.
- **Perf:** rebuilding the map is the cost — build for a normalized rounded-rect once, then only animate `scale`/reposition. Clip backdrop-filter to the element's rect; never full-page.
- **Caveat:** `backdrop-filter: url(#filter)` with displacement works ONLY in Chromium (broken in Safari/Firefox). OK for a Chrome extension.

## Single deformable border (kills the "slug"/gap — one continuous path, never a 2nd object)
B1 (recommended): sample the rounded-rect outline into N≈120–200 points (by arc length, keep outward normals).
Find perimeter point nearest cursor at arc-pos `s*`. Displace each point outward along its normal:
```
bulge_i = A * exp( -(d_i)^2 / (2*σ^2) ) * proximity      // d_i = wrapped arc dist |s_i − s*|
p_i' = p_i + n_i * bulge_i
proximity = clamp(1 − cursorDist/R, 0, 1)                 // R≈80–120 → grows near, returns far
```
Start values: A (max bulge) 8–16px, σ 30–60px arc, N 120–200. Then draw ONE closed **centripetal Catmull-Rom** through `p_i'`, converting each segment to cubic Bézier:
```
B1 = P1 + (P2 − P0)/6 ;  B2 = P2 − (P3 − P1)/6 ;  bezierCurveTo(B1, B2, P2)   // wrap indices
```
Emit as an SVG `<path d>` and animate `d` per frame (fixed N so morph is valid). This path also carries the Liquid Glass material above.

Goo filter (safety net only, not primary): Lucas Bebber `feGaussianBlur stdDeviation=10` + `feColorMatrix ...0 0 0 18 -7` + `feComposite atop` fuses overlapping shapes — but blurs the crisp rim. Use only for a gooier look.

## Recommendation
**SVG overlay, one `<path>`** = the B1-deformed rounded rect, with `backdrop-filter: url(#liquid-glass)` + inset/rim shadows. One path = no gap possible. Inject `position:fixed; pointer-events:none; z-index:max`, update `d` + cursor projection on rAF-throttled mousemove, clip backdrop-filter to the element rect, don't rebuild the map per frame.

## Visual loop (build before judging)
One static `index.html` opened directly in Chrome: full-bleed busy **photo** background (glass is invisible over flat color), a row of mock targets, the highlight rendered in frozen states (idle / cursor-near-edge / cursor-at-corner / cursor-far) with hardcoded cursor points, and `<input type=range>` sliders bound to A, σ, R, displacement scale, blur, saturate. `drawHighlight(state)` shared with the content script so the playground IS the harness. Drop an Apple "Meet Liquid Glass" still beside it and diff.

## Verified sources
- kube.io/blog/liquid-glass-css-svg (physics/Snell's-law canonical) · blog.logrocket.com/how-create-liquid-glass-effects-css-and-svg
- github.com/shuding/liquid-glass (1k★) · github.com/rizroze/liquid-glass (best-documented params, 3-pass aberration) · github.com/kevinbism/liquid-glass-effect (pure CSS)
- css-tricks.com/gooey-effect (goo filter) · developer.apple.com/videos/play/wwdc2025/219 ("Meet Liquid Glass")
- WebKit bug 245510 (Safari can't do displacement backdrop-filter — Chromium-only)
- B1 falloff numbers are recommended starting values to tune in the playground, not quoted.
