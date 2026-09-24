# T-01 WeChat Add visual evidence

- Captured: 2026-09-24
- Renderer: Playwright Chromium
- Viewport: 390×844
- Source: production `presentWechatCatalogIntake` output assigned directly to
  one fixed neutral chat bubble's `textContent`
- Machine report: [`report.json`](./report.json)

## Reviewed scenarios

- `three-candidates-390x844.png`: three candidates remain individually
  scannable; address and Google attribution sit below each name; the select
  command is isolated at the bottom.
- `complete-preview-390x844.png`: identity, area, address, location status,
  Tabelog and reservation facts form one compact fact block; confirm and cancel
  are visually separated from it.
- `warning-conflict-390x844.png`: the no-write statement leads; three selected
  warnings and the folded-evidence notice form a separate block; the refreshed
  confirm/cancel choices remain fully visible in the first viewport.
- `success-390x844.png` and `failed-no-write-390x844.png`: terminal outcomes
  remain short and readable without receipt or internal diagnostics.

All five measured bubbles have `scrollWidth === clientWidth` (312 px). The
screenshots are full 390×844 viewport captures; no scenario-specific CSS or
reply rewriting is used.
