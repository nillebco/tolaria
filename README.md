![Latest stable](https://img.shields.io/github/v/release/refactoringhq/tolaria?display_name=tag) [![CI](https://github.com/refactoringhq/tolaria/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/refactoringhq/tolaria/actions/workflows/ci.yml) [![Codecov](https://codecov.io/gh/refactoringhq/tolaria/graph/badge.svg?branch=main)](https://codecov.io/gh/refactoringhq/tolaria) [![CodeScene Hotspot Code Health](https://codescene.io/projects/76865/status-badges/hotspot-code-health)](https://codescene.io/projects/76865)

# 💧 Tolaria

Tolaria is a desktop app for macOS, Windows, and Linux for managing **markdown knowledge bases**. People use it for a variety of use cases:

* Operate second brains and personal knowledge
* Organize company docs as context for AI
* Store OpenClaw/assistants memory and procedures

Personally, I use it to **run my life** (hey 👋 [Luca here](http://x.com/lucaronin)). I have a massive workspace of 10,000+ notes, which are the result of my [Refactoring](https://refactoring.fm/) work + a ton of personal journaling and *second braining*.

<img width="1000" height="656" alt="1776506856823-CleanShot_2026-04-18_at_12 06 57_2x" src="https://github.com/user-attachments/assets/8aeafb0a-b236-43c2-a083-ec111f903c38" />

## Walkthroughs

You can find some Loom walkthroughs below — they are short and to the point:
- [How I Organize My Own Tolaria Workspace](https://www.loom.com/share/bb3aaffa238b4be0bd62e4464bca2528)
- [My Inbox Workflow](https://www.loom.com/share/dffda263317b4fa8b47b59cdf9330571)
- [How I Save Web Resources to Tolaria](https://www.loom.com/share/8a3c1776f801402ebbf4d7b0f31e9882)

## Principles

- 📑 **Files-first** — Your notes are plain markdown files. They're portable, work with any editor, and require no export step. Your data belongs to you, not to any app.
- 🔌 **Git-first** — Every vault is a git repository. You get full version history, the ability to use any git remote, and zero dependency on Tolaria servers.
- 🛜 **Offline-first, zero lock-in** — No accounts, no subscriptions, no cloud dependencies. Your vault works completely offline and always will. If you stop using Tolaria, you lose nothing.
- 🔬 **Open source** — Tolaria is free and open source. I built this for [myself](https://x.com/lucaronin) and for sharing it with others.
- 📋 **Standards-based** — Notes are markdown files with YAML frontmatter. No proprietary formats, no locked-in data. Everything works with standard tools if you decide to move away from Tolaria.
- 🔍 **Types as lenses, not schemas** — Types in Tolaria are navigation aids, not enforcement mechanisms. There's no required fields, no validation, just helpful categories for finding notes.
- 🪄**AI-first but not AI-only** — A vault of files works very well with AI agents, but you are free to use whatever you want. We support Claude Code, Codex CLI, and Gemini CLI setup paths, but you can edit the vault with any AI you want. We provide an AGENTS file for your agents to figure out.
- ⌨️ **Keyboard-first** — Tolaria is designed for power-users who want to use keyboard as much as possible. A lot of how we designed the Editor and the Command Palette is based on this.
- 💪 **Built from real use** — Tolaria was created for manage my personal vault of 10,000+ notes, and I use it every day. Every feature exists because it solved a real problem.

## Installation

### Homebrew

Install via Homebrew on macOS:

```batch
brew install --cask tolaria
```

### Download from releases

Download the [latest release here](https://refactoringhq.github.io/tolaria/download/) for macOS, Windows, or Linux.

## Getting started

When you open Tolaria for the first time you get the chance of cloning the [getting started vault](https://github.com/refactoringhq/tolaria-getting-started) — which gives you a walkthrough of the whole app.

The public user docs live in [`site/`](site/) and are published to GitHub Pages. Start with [Install Tolaria](site/start/install.md), then [First Launch](site/start/first-launch.md).

## Saved View YAML

Saved Views are portable `.yml` files stored in the vault's `views/` folder.
They can be edited by Tolaria or by hand. A minimal view looks like this:

```yaml
name: Current ADB activities
icon: list-checks
color: blue
sort: "Date:desc"
listPropertiesDisplay:
  - Date
  - OnBehalfOf
  - Status
filters:
  all:
    - field: type
      op: equals
      value: Activity
    - field: OnBehalfOf
      op: equals
      value: ADB
    - field: Date
      op: after
      value: 2026-05-07
```

Top-level fields:

| Field | Meaning |
|---|---|
| `name` | Display name shown in the sidebar and table header. |
| `icon` | Optional icon name. Use `null` or omit it for no icon. |
| `color` | Optional color token. Use `null` or omit it for the default color. |
| `order` | Optional number used to order Saved Views in the sidebar. Lower values appear first. |
| `sort` | Optional saved sort, for example `"modified:desc"` or `"Date:asc"`. |
| `listPropertiesDisplay` | Optional frontmatter property names shown in the note list and used as default table columns. |
| `filters` | Required filter tree. Use `all` for AND groups and `any` for OR groups. |
| `table` | Optional table presentation settings used by **Open View as Table**. |

Filter conditions use `field`, `op`, and usually `value`:

```yaml
filters:
  any:
    - field: status
      op: equals
      value: active
    - all:
        - field: type
          op: equals
          value: Activity
        - field: Date
          op: after
          value: 2026-04-30
```

`field` can be a built-in field such as `title`, `type`, `status`, `modified`,
`created`, `archived`, or `favorite`. It can also be any frontmatter property
name, such as `Date`, `OnBehalfOf`, `Project`, or `Priority`.

Supported operators are:

| Operator | Meaning |
|---|---|
| `equals` / `not_equals` | Exact case-insensitive match. |
| `contains` / `not_contains` | Text contains match; array properties match individual elements. |
| `any_of` / `none_of` | Match against any value in a YAML list. |
| `is_empty` / `is_not_empty` | Check whether the field is blank or missing. |
| `before` / `after` | Date comparison. The comparison is strict, so `after: 2026-05-07` starts on May 8, 2026. |

Add `regex: true` to a condition to interpret `value` as a regular expression
for supported text operators.

Table settings are optional. If `table.columns` is omitted, the table uses
`title` plus `listPropertiesDisplay`, or a conservative default set.

```yaml
table:
  columns:
    - title
    - property:Date
    - computed:quantity
    - property:OnBehalfOf
    - property:Status
  computedColumns:
    quantity: Hours
    amount: 'if(item == "carrot", quantity * 2, quantity * 3)'
  columnFilters:
    "property:item":
      op: equals
      value: carrot
  columnSize:
    title: 260
    "property:Date": 140
    "computed:quantity": 120
    "property:OnBehalfOf": 180
  density: compact
  summaries:
    "property:Hours": sum
    "computed:amount": sum
    "property:OnBehalfOf": unique
```

Table column IDs:

| Column ID | Meaning |
|---|---|
| `title` | Note title. |
| `filename` | Markdown filename. |
| `type` | Canonical `type:` frontmatter value. |
| `status` | Status value. |
| `modified` | Modified date. |
| `created` | Created date. |
| `property:<Name>` | Any frontmatter property, for example `property:Date`. |
| `computed:<alias>` | A computed alias declared in `table.computedColumns`, for example `computed:quantity`. |

Quote map keys that contain `:` in YAML, such as `"property:Date"`.
`table.computedColumns` supports simple aliases such as `quantity: Hours`, plus
small formulas with field references, strings, numbers, arithmetic,
comparisons, and `if(condition, when_true, when_false)`.
Formula syntax:

| Syntax | Example |
|---|---|
| Field reference | `quantity` |
| String literal | `"carrot"` |
| Number literal | `2`, `3.5` |
| Arithmetic | `quantity * 2`, `(quantity + 1) / 2` |
| Comparison | `item == "carrot"`, `quantity >= 10` |
| Conditional | `if(item == "carrot", quantity * 2, quantity * 3)` |

Formula cells fail closed as empty cells when the formula is invalid.
`table.columnFilters` narrows table rows after the saved view's normal filters.
Use `op: equals` for exact matches or `op: contains` for substring matches.
Supported table summaries are `count`, `empty`, `unique`, and `sum`.
When a saved view is open as a table, the toolbar can copy the current table as
CSV or export it to a `.csv` file. The exported CSV uses the currently rendered
columns and rows after table column filters.
Drag column headers to change `table.columns`. Click a column header label to
cycle the saved view `sort` value through ascending, descending, and the default
saved-view order. Date-like frontmatter values such as `2026-05-08` sort by date
value rather than plain text.

## Open source and local setup

Tolaria is open source and built with Tauri, React, and TypeScript. If you want to run or contribute to the app locally, here is [how to get started](https://github.com/refactoringhq/tolaria/blob/main/docs/GETTING-STARTED.md). You can also find the gist below 👇

### Prerequisites

- Node.js 20+
- pnpm 8+
- Rust stable
- macOS or Linux for development

#### Linux system dependencies

Tauri 2 on Linux requires WebKit2GTK 4.1 and GTK 3:

- Arch / Manjaro:
  ```bash
  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
    appmenu-gtk-module libappindicator-gtk3 librsvg
  ```
- Debian / Ubuntu (22.04+):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    libsoup-3.0-dev patchelf
  ```
- Fedora 38+:
  ```bash
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
    libappindicator-gtk3-devel librsvg2-devel
  ```

The bundled MCP server still spawns the system `node` binary at runtime on Linux, so install Node from your distro package manager if you want the external AI tooling flow.

### Quick start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` for the browser-based mock mode, or run the native desktop app with:

```bash
pnpm tauri dev
```

## Tech Docs

- 📐 [ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design, tech stack, data flow
- 🧩 [ABSTRACTIONS.md](docs/ABSTRACTIONS.md) — Core abstractions and models
- 🚀 [GETTING-STARTED.md](docs/GETTING-STARTED.md) — How to navigate the codebase
- 📚 [ADRs](docs/adr) — Architecture Decision Records

## Security

If you believe you have found a security issue, please report it privately as described in [SECURITY.md](./SECURITY.md).

## License

Tolaria is licensed under AGPL-3.0-or-later. The Tolaria name and logo remain covered by the project’s trademark policy.
