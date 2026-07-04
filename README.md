# MagPoint

**A magnetic cursor for the web.** MagPoint pulls your mouse pointer toward the nearest
clickable element — links, buttons, inputs — on *any* page, so small targets become
effortless to hit. A pointing-assist & accessibility tool, not a cosmetic cursor skin.

https://github.com/user-attachments/assets/7b93d4d9-4d36-48e9-bb40-90440160775d

The captured element wears a **liquid-glass highlight** — a single deformable outline
that bulges toward your pointer, refracting the page behind it. Purely cosmetic:
selection never depends on the animation, so it can't mis-click.

> Status: working and fun. Chrome Web Store release in progress.

## Install

- **Chrome Web Store**: coming soon.
- **From source** (Chrome / Chromium):

  ```sh
  npm install && npm run build
  ```

  Then open `chrome://extensions`, enable *Developer mode*, click *Load unpacked*,
  and pick `.output/chrome-mv3`. Press **Alt+M** on any page to toggle MagPoint.

The liquid-glass lens uses `backdrop-filter: url(#…)`, which currently renders in
Chromium only. Selection works everywhere; Firefox gets a simplified highlight (planned).

## Why

Hitting small or densely-packed UI is slow and error-prone — and much harder for older
users or anyone with reduced motor precision. This is one of the oldest problems in HCI
("pointing facilitation" / *beating Fitts' law*), with decades of research showing the
cursor *can* be made to help. Almost none of it ever shipped to ordinary people on a
normal mouse, on the open web. MagPoint is that.

## How it works

MagPoint is built on the **bubble cursor** (Grossman & Balakrishnan, CHI 2005). Every
frame it finds the clickable element with the smallest point-to-rectangle distance to the
pointer and captures *exactly that one* — equivalent to selecting whichever target's
Voronoi cell the cursor sits in.

This is the key property: naive "sticky"/gravity cursors get **trapped** on every target
they pass on the way to the one you want (worst right next to your goal). The bubble rule
caps its reach at the *second*-nearest target, so it can never grab two at once — it stays
robust on dense, link-heavy pages. The pointer then eases toward the captured target while
the real hit-test stays exact, so the pull is delightful but never mis-clicks.

Research this builds on:

- Grossman & Balakrishnan, *The bubble cursor* (CHI 2005) — [10.1145/1054972.1055012](https://doi.org/10.1145/1054972.1055012)
- Balakrishnan, *"Beating" Fitts' law* (IJHCS 2004) — [10.1016/j.ijhcs.2004.09.002](https://doi.org/10.1016/j.ijhcs.2004.09.002)
- Blanch et al., *Semantic pointing* (CHI 2004) — [10.1145/985692.985758](https://doi.org/10.1145/985692.985758)
- Worden et al., *Area cursors and sticky icons* (CHI 1997) — [10.1145/258549.258724](https://doi.org/10.1145/258549.258724)

## Development

Built with [WXT](https://wxt.dev) (Vite-powered MV3).

```sh
npm install
npm run dev        # launches a dev browser with the extension loaded
npm run build      # production build
npm run compile    # type-check
```

## License

MIT © Satoyoshi Hirano
