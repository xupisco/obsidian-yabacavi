# Yabacavi

**Y**et **A**nother **BA**ses **CA**lendar **VI**ew — a calendar view for Obsidian [Bases](https://help.obsidian.md/bases).

Notes become cards on a **day, week or month** grid, placed by any date property. **Drag a card** to another day to reschedule it, and click one to open the note.

Requires Obsidian **1.10.2+** with the **Bases** core plugin enabled.

## Features

- **Day / week / month** grid, with toolbar navigation and a *Today* button.
- Place notes by any **date property** — frontmatter, formula or intrinsic file date.
- Cards show whichever properties you made visible in the base, so a calendar and a
  table over the same base stay in sync. Formula properties render through Bases, so
  `html()` in a formula works on a card the same as in a table.
- **Drag & drop to reschedule** — drop a card on another day to rewrite its date
  property. The time of day and any timezone offset are preserved; a date-only
  property stays date-only. The dragged card follows the cursor and swings from
  the point you grabbed it.
- **Status → accent colour** — map a property's values (e.g. `todo`, `done`) to a
  coloured accent bar, from the settings tab.
- **Open notes** in a floating modal, the current tab, a new tab or a split.
- **Double-click an empty day** to create a note dated to it, optionally from a
  template file.
- **Hover** a card for the normal page preview; **right-click** for the file menu;
  **ctrl/cmd-click** to open in a new pane.
- Show or hide **weekends**; choose the **week start**.

> Drag & drop uses the browser's native drag, which doesn't fire on touch, so
> rescheduling is desktop-only. Viewing, opening and creating notes work on mobile.

## Usage

1. Open or create a `.base` file.
2. Add a view and pick **Calendar cards** as its type (or set `type: calendar-cards`
   in the view's YAML).
3. In the view options, choose a **Date property** — nothing renders until you do.
4. Cards display the properties in the base's visible-property list, same as a table.

## View options (per view, in the base)

| Option | What it does |
| --- | --- |
| Date property | Which property places the note on the grid. Required. |
| Range | Day, week or month. The toolbar buttons write the same setting. |
| Week starts on | Sunday or Monday. |
| Show weekends | When off, Saturday/Sunday are hidden for a 5-column grid. |
| Show time on cards | Show the time when the date has one. |

## Plugin settings (global)

| Setting | What it does |
| --- | --- |
| Open notes in | Floating modal, current tab, new tab or split — for clicking a card and for new notes. |
| New note template | Template file copied into notes created from the calendar (raw copy; template variables aren't expanded). |
| Status property | Frontmatter property whose value selects the accent colour. |
| Status colours | Map status values to accent-bar colours. |

## Customising with CSS

Every card mirrors its note's frontmatter as `data-*` attributes and exposes a few
CSS variables, so a theme or snippet can restyle cards freely:

```css
/* colour the accent bar by status */
.yabacavi-card[data-status="done"]  { --yabacavi-accent-color: var(--color-green); }
.yabacavi-card[data-status="doing"] { --yabacavi-accent-color: var(--color-yellow); }

/* fade completed cards */
.yabacavi-card[data-status="done"] { opacity: 0.5; }
```

Handy hooks:

- `[data-<property>="…"]` on each card, from the note's frontmatter (`[data-status]`,
  `[data-project]`, …). List values match with `~=`.
- `--yabacavi-accent-color` / `--yabacavi-accent-width` on `.yabacavi-card`.
- `--yabacavi-day-min-height` on `.yabacavi`.

Status colours set in the settings tab are applied inline, so they win over CSS
rules; leave the list empty to drive the accent entirely from your own CSS.

## Install (Community plugins)

Once the plugin is in the directory:

1. Open *Settings → Community plugins* and turn off **Restricted mode**.
2. Click **Browse**, search for **Yabacavi**, open its page.
3. Click **Install**, then **Enable**.

## Install (BRAT — before it's in the directory)

With [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from *Settings → Community plugins → Browse*.
2. Run **BRAT: Add a beta plugin for testing** from the command palette.
3. Paste the repository URL:
   ```
   https://github.com/xupisco/obsidian-yabacavi
   ```
4. Confirm — BRAT installs the latest release and keeps it updated.
5. Enable **Yabacavi** in *Settings → Community plugins*.

## Install (manual / development)

```bash
npm install
npm run build      # produces main.js
```

Copy `main.js`, `manifest.json` and `styles.css` into your vault at
`<vault>/.obsidian/plugins/yabacavi/`, then reload Obsidian and enable the plugin.

## Develop

```bash
npm install
npm run dev        # esbuild watch; rebuilds main.js on change
npm run build      # typecheck + production bundle
npm run lint       # typecheck + eslint (obsidianmd rules)
```

Set `OBSIDIAN_PLUGIN_DIR` to your vault's plugin folder and `npm run dev` deploys
`main.js`, `manifest.json` and `styles.css` there on every rebuild:

```bash
OBSIDIAN_PLUGIN_DIR="/path/to/Vault/.obsidian/plugins/yabacavi" npm run dev
```

## License

[MIT](LICENSE)
