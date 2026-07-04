# Chrome Web Store — submission kit (v0.1.0)

Everything needed to fill the Developer Dashboard forms. Assets live in
`demo-studio/out/store/` (regenerate with `node demo-studio/store.mjs`).
Package: `.output/magpoint-0.1.0-chrome.zip` (regenerate with `npm run zip`).

## Listing

| Field | Value |
|---|---|
| Name | MagPoint — magnetic cursor |
| Summary (≤132 chars) | A magnetic cursor for the web: snaps your pointer to the nearest clickable element. Pointing assist built on HCI research. |
| Category | Accessibility |
| Language | English |
| Screenshots (1280×800) | `shot-1-hn.png` … `shot-5-demo.png` |
| Small promo tile (440×280) | `tile-small-440x280.png` |
| Marquee (1400×560, optional) | `tile-marquee-1400x560.png` |
| Promo video | YouTube link — upload `demo-studio/out/master.mp4` (owner step, satoyoshi44 channel) |

## Detailed description

```
MagPoint pulls your mouse pointer toward the nearest clickable element — links,
buttons, checkboxes — on any page, so small and densely packed targets become
effortless to hit.

It is a pointing-assist and accessibility tool, not a cosmetic cursor skin.
Hitting small UI is one of the oldest problems in human-computer interaction
research, and MagPoint ships the best-known answer to it: the bubble cursor
(Grossman & Balakrishnan, CHI 2005). Every frame it captures exactly one
element — the one nearest to your pointer — so it never grabs two targets at
once and stays stable on link-dense pages.

The captured element wears a subtle liquid-glass highlight that stretches
toward your pointer, so you always know where your click will land. The
highlight is purely cosmetic: the selection logic never depends on the
animation, so it cannot mis-click.

— Works on any page
— Press Alt+M to toggle on/off
— Stands down automatically while you type in text fields or select text
— No data collection of any kind: no analytics, no network requests, nothing
  leaves the tab

MagPoint is free and open source (MIT).
```

## Privacy tab

- **Single purpose description**:
  `MagPoint assists pointing: it moves clicks to the clickable element nearest the cursor and highlights it, making small targets easier to hit (an accessibility aid based on the bubble cursor, CHI 2005).`
- **Permission justification — content script on `<all_urls>`**:
  `A pointing aid is only useful if it works on every page the user visits. The content script measures the positions of clickable elements in the current tab to draw the highlight and route the click. It runs entirely locally, makes no network requests, and collects no data.`
- **Are you using remote code?** No.
- **Data usage**: check **nothing** (no data collected). Certify the disclosures.
- **Privacy policy URL**: public copy of `PRIVACY.md` (gist — see checklist).

## Distribution

- Visibility: **Public**
- Regions: all
- Pricing: free

## Submission checklist

1. [owner] Register as a Chrome Web Store developer with **satoyoshi44@gmail.com**
   at https://chrome.google.com/webstore/devconsole ($5 one-time, card payment).
2. [owner] Publish `PRIVACY.md` as a public gist (URL goes in the Privacy tab).
3. Upload `.output/magpoint-0.1.0-chrome.zip` → fills manifest fields automatically.
4. Paste listing fields + description from this file; upload screenshots + tiles.
5. Fill the Privacy tab from this file; set distribution Public/free.
6. [owner] Submit for review.
7. While in review: keep the repo private; add the GitHub URL to the listing
   after the repo goes public at launch (listing edits don't reset review).
