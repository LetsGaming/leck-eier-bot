---
name: leck-eier-bot Dashboard
description: Discord's own client chrome, reused as an admin panel for one server's moderators.
colors:
  discord-blurple: "#5865f2"
  discord-blurple-hover: "#4752c4"
  client-chrome-base: "#313338"
  client-chrome-elevated: "#2b2d31"
  client-chrome-inset: "#1e1f22"
  border-subtle: "#3f4147"
  text-primary: "#f2f3f5"
  text-muted: "#949ba4"
  success: "#23a55a"
  success-tint-text: "#7ee2a8"
  success-tint-bg: "#12271c"
  danger: "#f23f42"
  danger-deep: "#da373c"
  danger-tint-text: "#ff8a8d"
  danger-tint-bg: "#2b1416"
  warning: "#f0b232"
  warning-deep: "#e8730c"
  danger-severe: "#a12226"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.5
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.5
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  code:
    fontFamily: "ui-monospace, 'Cascadia Code', 'Segoe UI Mono', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.9em"
rounded:
  sm: "4px"
  xs: "6px"
  md: "8px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.discord-blurple}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.discord-blurple-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-danger-hover:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.client-chrome-elevated}"
    rounded: "{rounded.md}"
    padding: "20px"
  input:
    backgroundColor: "{colors.client-chrome-inset}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
---

# Design System: leck-eier-bot Dashboard

## Overview

**Creative North Star: "Same Client, Different Door"**

This dashboard doesn't approximate a dark theme — its background, elevation, border, text, and accent colors are Discord's own actual client values, byte-for-byte: `#313338`, `#2b2d31`, `#1e1f22`, and Discord's brand Blurple `#5865f2` all appear here exactly as they do in Discord itself. The premise is that an admin who moderates this server all day should never feel like they've left Discord to configure it; they've just walked through a different door into the same building. Nothing about the visual language is invented or "inspired by" — it's borrowed, deliberately and completely, in service of a single primary user who is fluent in Discord and nothing else about bot-admin tooling (see PRODUCT.md § Users).

That borrowing extends to restraint, not just color: components are quiet and utilitarian by design. Flat cards, an 8px radius everywhere, minimal chrome — the interface recedes so a moderator's actual task (approve this registration, resolve this sign-up, toggle this command) stays the visual subject, not the app around it. This is a data-forward, Operate-mode tool built for one specific community's returning admins, not a first-impression surface for strangers — there is no onboarding flourish to design for, because there is no cold-start visitor to win over.

Two confirmed rejections bound the system on both sides: it must never drift toward a generic glossy SaaS admin panel (gradient hero banners, marketing-site polish, "enterprise dashboard" visual clichés), and — despite the bot's own informal, irreverent name — it must never read as playful or cartoonish. The tone is a serious moderation tool wearing Discord's own clothes, not a whimsical companion app.

**Key Characteristics:**
- Every core color is Discord's own value, not an approximation or a "matching" palette — see The Borrowed, Not Inspired Rule below.
- Flat at rest everywhere; shadow exists only on content that floats above the page (popovers, the confirm dialog, toasts) — never on a resting card or stat tile.
- Type scale is named by role (`display`/`headline`/`title`/`body`/`label`/`meta`/`code`), not authored per page, so the same role is pixel-identical everywhere it appears.
- No component library, no state-management library — every control is hand-built from plain CSS custom properties, matching PRODUCT.md's "dependency-light by choice" principle.
- Dense, data-forward layouts (tables, tally grids, stat tiles) tuned for a returning admin working through a real task, not a stranger's first five minutes.

## Colors

A three-step neutral "Client Chrome" ladder carries almost the entire surface; one accent (Discord's own Blurple) and three status colors do all remaining work — sparingly, and only where they mean something.

### Primary
- **Discord Blurple** (`#5865f2`): the one accent color in the system — primary buttons, the active sidebar nav item, focus outlines, links, the favicon's egg mark, and every "this is the live, clickable thing" signal. **Discord Blurple Hover** (`#4752c4`) is its only variant, used exclusively on `:hover`.

### Neutral — "Client Chrome"
- **Client Chrome Base** (`#313338`): the page background — Discord's own app background, exactly.
- **Client Chrome Elevated** (`#2b2d31`): cards, stat tiles, popovers, the sidebar's off-canvas drawer — one visible step "above" the base, the way a Discord sidebar or panel sits above the message area.
- **Client Chrome Inset** (`#1e1f22`): input fields, the sidebar itself, and anything meant to read as "recessed" or "where you type" — Discord's own input-well color.
- **Border Subtle** (`#3f4147`): the one border color used almost everywhere a division is needed — cards, inputs, table rows, dividers. A colored border is never decorative; see The Signal Border Rule below.
- **Text Primary** (`#f2f3f5`) / **Text Muted** (`#949ba4`): body text and its quieter secondary register — labels, hints, timestamps, metadata.

### Status
- **Success** (`#23a55a`), **Danger** (`#f23f42`, deepening to `#da373c` on hover/fill), **Warning** (`#f0b232`): kept as plain functional names, not descriptive ones — deliberately, because they're read instantly and literally from Discord's own vocabulary (the same green/red/amber an admin already associates with those meanings there). Naming them poetically would work against that instant recognition.
- **Danger Severe** (`#a12226`) and **Warning Deep** (`#e8730c`): two graduated-severity tiers beyond the base trio, used only for Event-Anwesenheit's lateness/early-leave badges (`moderate`/`severe`) — a deliberately darker step signaling "worse than the base warning/danger," never a general-purpose fourth and fifth status color.
- **Tint pairs** (`success-tint-text` `#7ee2a8` over `success-tint-bg` `#12271c`; `danger-tint-text` `#ff8a8d` over `danger-tint-bg` `#2b1416`): a lighter foreground/darker background pairing used specifically where status text sits directly on its own tinted surface (alert banners, toasts) rather than on `client-chrome-elevated` — the base `success`/`danger` hex values read fine as badge text on a neutral card, but need this brightened variant to stay legible on their own darkened background.

### Named Rules
**The Borrowed, Not Inspired Rule.** Every core color is Discord's own actual value, not a palette "inspired by" or "matching" Discord. A new color proposed for this system must be justified against a real Discord client color it borrows from — never invented from taste alone.

## Typography

**Body/UI Font:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (the platform system-font stack)
**Code/Data Font:** `ui-monospace, "Cascadia Code", "Segoe UI Mono", Consolas, "Liberation Mono", monospace`

**Character:** One plain system-font stack, used everywhere prose or UI chrome appears — an admin tool, not a marketing surface, has no reason to load or pair a custom typeface. The monospace family is reserved strictly for a "this is exact syntax, copy it precisely" register (template placeholders, cron expressions, Discord IDs), never for a "technical" costume elsewhere.

### Hierarchy
- **Display** (600, 32px): the single hero number a stat tile exists to show (Overview's member/panel counts, Birthdays' "next up" tile). The one role deliberately allowed to jump the scale rather than step through it — reserved for exactly this purpose, never reused for anything else.
- **Headline** (700, 22px): page titles only, one per page.
- **Title** (600, 16px): card and section headings.
- **Body** (400, 14px, line-height 1.5): the default reading size — prose, inputs, table cells, alerts, toasts, template previews. Comfortable measure capped at 60ch on hint/intro paragraphs (`.muted.small`), never left to run edge-to-edge in a wide card.
- **Label** (500, 12px): field labels, hints, secondary notes — supporting text, not the primary read.
- **Meta** (600, 11px, uppercase, 0.04em tracking): badges, table headers, timestamps — decorative/meta text that is never prose. Sits close to Label in size deliberately; the two are told apart by weight, case, and color, not by size alone.
- **Code** (monospace, 0.9em, tabular numerals): inline syntax and data — template tokens, cron expressions, Discord snowflake IDs.

### Named Rules
**The Named-Role Rule.** Every text size is a named role (`display`/`headline`/`title`/`body`/`label`/`meta`), never a one-off pixel value authored per page. A repeated role must stay pixel-identical everywhere it appears; a genuinely new size needs a new named role, not a local exception.

## Layout

No `.card` is nested inside another `.card`. Content is organized as a single-column page (`.main-inner`, capped at 1600px, centered) built from stacked cards and card-grids — most pages are one linear read, not a dashboard-grid-of-widgets composition.

`.card-grid` auto-fits columns with a 340px minimum (2-4 columns depending on viewport); `.card-grid-registration` raises that floor to 560px on Settings → Registrierung specifically, where hint prose is unusually dense and needs a wider column to stay above a 45ch comfortable measure. Grid items top-align (`align-items: start`) rather than stretch, so a short card never balloons into a mostly-empty bordered box beside a taller neighbor — the leftover space reads as ordinary page whitespace instead.

Spacing is ad hoc pixel values (8/12/16/20/24px recur most often) rather than a formal token scale — there is no `--spacing-*` custom property family; this matches the project's deliberately dependency-light, no-abstraction-for-its-own-sake convention (PRODUCT.md § Capabilities and Constraints) rather than being an oversight.

**Responsive behavior**, two breakpoints:
- **860px** (shell): the sidebar becomes a fixed, off-canvas drawer (slides in via `transform: translateX`), triggered by a hamburger in a new mobile top bar; a semi-opaque backdrop closes it on tap.
- **700px** (content): card grids and form rows collapse to a single column, the reaction-roles two-pane layout stacks vertically, and every data table switches to a stacked label/value card layout per row (`.stack-on-mobile`) instead of scrolling horizontally.

## Elevation & Depth

Hybrid, and the split is deliberate: everything at rest is flat, distinguished only by the three-step Client Chrome tonal ladder (base → elevated → inset) — never a shadow. Shadow is reserved exclusively for content that floats above the page's own z-order: popovers (`0 8px 24px rgba(0,0,0,0.4)`), the confirm dialog (`0 16px 48px rgba(0,0,0,0.45)`), and toasts (`0 8px 24px rgba(0,0,0,0.35)`). A shadow is structural — "this is temporarily above everything else" — never ambient decoration on a resting surface.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 8px 24px rgba(0,0,0,0.4)`): SearchableSelect's popover, the emoji picker, the month-calendar picker.
- **Modal** (`box-shadow: 0 16px 48px rgba(0,0,0,0.45)`): the confirm dialog — the single heaviest shadow in the system, reserved for the one surface that blocks the whole page.
- **Toast** (`box-shadow: 0 8px 24px rgba(0,0,0,0.35)`): transient success/error notifications, bottom-right.

### Named Rules
**The Flat-at-Rest Rule.** Cards, stat tiles, and every other resting surface never carry a shadow — depth there comes only from the Client Chrome tonal ladder. Shadow appears exclusively on content that floats above the page: popovers, the confirm dialog, and toasts.

## Shapes

`8px` (`md`) covers nearly every rectangular surface that reads as its own container — cards, inputs, buttons, popovers. Two smaller steps handle compact/inline elements specifically: `6px` (`xs`) for small interactive controls sitting inside a larger container (the emoji-grid button, a SearchableSelect option row), and `4px` (`sm`) for inline/embedded chrome (the `<code>` tag, the template-editor pill, and several Discord-mirroring pieces of the message-preview mockup). Full-round (`999px`) is reserved for pill-shaped elements specifically: badges, role/emoji chips, the switch track and thumb, month-nav pills. Avatars and their no-image placeholders are perfect circles. Borders are 1px and `border-subtle` by default everywhere; a colored border is never decorative.

### Named Rules
**The Signal Border Rule.** A colored (non-`border-subtle`) border always means something specific: `--warning` on an attention-needed card, `--accent` on the current month-calendar cell or an event-card's hover/focus state. A neutral card's border is always `border-subtle` — reach for a colored border only to signal state, never for visual variety.

## Components

### Buttons
- **Shape:** 8px radius, no border by default.
- **Primary:** Discord Blurple background, white text, `8px 16px` padding — the one call-to-action color in the system, used sparingly.
- **Danger:** transparent background, `danger`-colored text and 1px border at rest; fills solid `danger` with white text on hover — a deliberately two-stage warning (quiet until you're about to commit).
- **Default/Ghost:** `client-chrome-inset` background, primary text — the fallback for every button that isn't the primary or a destructive action.
- **Disabled:** 0.5 opacity, `cursor: not-allowed`, same shape.

### Chips & Badges
- **Badge:** full-round pill, `meta` typography, five status fills at 12-20% opacity over their solid text color (`ok`/`warn`/`error` use `success`/`warning`/`danger`; `moderate`/`severe` step down to `warning-deep`/`danger-severe` for graduated lateness severity on Event-Anwesenheit).
- **Role/emoji chip:** full-round pill, `client-chrome-elevated` background, no border.

### Cards / Containers
- **Corner Style:** 8px radius.
- **Background:** `client-chrome-elevated`.
- **Shadow Strategy:** none — see Elevation & Depth.
- **Border:** 1px `border-subtle`; swaps to `warning` for an attention-needed card.
- **Internal Padding:** 20px (16px below the 700px breakpoint).

### Inputs / Fields
- **Style:** `client-chrome-inset` background, 1px `border-subtle`, 8px radius, `8px 10px` padding.
- **Focus:** a 2px Discord Blurple outline, inset by 1px so it reads as a ring rather than pushing layout.
- **Select:** a hand-drawn chevron (matching SearchableSelect's own trigger arrow exactly) replaces the native appearance, so a plain `<select>` and the custom combobox read as the same control family.

### Navigation
- **Sidebar:** `client-chrome-inset` background, plain-text links (muted at rest, full-text-color + `client-chrome-elevated` background on hover, solid Discord Blurple fill on the active route) — icon plus label always together, never icon-only.
- **Mobile:** collapses to a hamburger-triggered off-canvas drawer below 860px; see Layout.

### Discord Message Preview (signature component)
A pixel-accurate mockup of how a message will actually render on Discord — avatar, `BOT` tag, timestamp, and the real reaction/button/dropdown chrome — used everywhere the dashboard composes a message the bot will post (reaction-role panels, birthday announcements). Deliberately breaks from the app's own token scale for its inner text (10/13/13/13px, not `--fs-*`) because the whole point is mirroring Discord's actual client sizes exactly, not this dashboard's own scale. This is the system's clearest expression of "Same Client, Different Door": before an admin commits to sending something, they see precisely what their server will see.

### SearchableSelect (signature component)
A combobox pattern reused for every role/channel/member picker in the app: type-to-filter trigger, portal-rendered popover positioned via `getBoundingClientRect()` (not CSS `position: absolute`, which gets clipped by any scrolling ancestor), full keyboard navigation, and a "Keine Treffer." empty state. One control family standing in for what would otherwise be a dozen bespoke pickers.

## Do's and Don'ts

### Do:
- **Do** pull any new color directly from Discord's own client or brand palette — never invent or approximate one (The Borrowed, Not Inspired Rule).
- **Do** keep every resting surface flat; reserve shadow strictly for popovers, modals, and toasts (The Flat-at-Rest Rule).
- **Do** give a repeated text role the same pixel size everywhere; add a new named role rather than a one-off size (The Named-Role Rule).
- **Do** pair every nav icon with a text label — never icon-only navigation.
- **Do** use a colored border only to signal state (attention, current, hover/focus) — otherwise `border-subtle` (The Signal Border Rule).

### Don't:
- **Don't** introduce gradients, marketing-site polish, or "enterprise SaaS dashboard" visual clichés — confirmed anti-reference.
- **Don't** let the interface read as playful or cartoonish, despite the bot's own informal name — confirmed anti-reference; this is a serious moderation tool.
- **Don't** add a light-mode variant without a deliberate product decision — none exists today, and the whole palette is keyed to Discord's own dark client chrome.
- **Don't** introduce a component library or state-management library — the dependency-light footprint is a constraint, not a gap (PRODUCT.md).
- **Don't** nest a `.card` inside another `.card`.
