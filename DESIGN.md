---
name: OpenCollector
description: A precise telemetry workspace with warm neutrals, layered charcoal actions, and purposeful motion.
colors:
  ink: "#242424"
  muted: "#6b6b70"
  canvas: "#fafaf9"
  surface: "#fff"
  line: "#ebebe9"
  accent: "#436bd8"
  action-top: "#444443"
  action-bottom: "#292928"
  action-hover: "#414140"
  navigation-selected: "#fff"
  navigation-text: "#2a2a28"
  field-border: "#e2e2df"
  success-surface: "#f0f7f1"
  success-text: "#30734a"
  error-surface: "#fdf1ef"
  error-text: "#af4941"
  chart-total-top: "#9aaccb"
  chart-total-bottom: "#7e95bd"
  chart-error: "#c77d73"
typography:
  headline:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(29px, 2.6vw, 36px)"
    fontWeight: 600
    lineHeight: 1.16
    letterSpacing: "-.04em"
  title:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 550
    lineHeight: 1.35
    letterSpacing: "-.025em"
  body:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    lineHeight: 1.5
  label:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 450
  metric:
    fontFamily: '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(24px, 2.1vw, 31px)"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-.04em"
  identifier:
    fontFamily: "ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 450
rounded:
  status: "6px"
  field: "8px"
  action: "9px"
  panel: "16px"
spacing:
  compact: "8px"
  small: "12px"
  regular: "16px"
  panel: "24px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action-bottom}"
    textColor: "{colors.surface}"
    rounded: "{rounded.action}"
    padding: "9px 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px"
  field:
    backgroundColor: "{colors.canvas}"
    textColor: "#363633"
    rounded: "{rounded.field}"
    padding: "8px 11px"
    height: "38px"
  status-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
---

# Design System: OpenCollector

## Overview

A quiet, carefully fitted telemetry workspace in the spirit of Emil Kowalski's interface craft. Warm near-white surfaces, optically sized Inter, fine neutral edges, and layered charcoal actions give dense data a calm hierarchy. The accepted sidebar, filters, metric strip, and analytics structure stays intact; the previous Apple-led visual description is superseded.

Motion explains a user-initiated change of state. It never decorates incoming telemetry or makes data wait for an entrance sequence. This document records `src/styles.css`, `src/main.tsx`, and `src/DashboardControls.tsx`.

## Colors

### Primary

Charcoal carries filled actions. Restrained blue supplies links, caret, and field focus; it does not fill the main action or navigation selection. Run-volume bars use muted blue with a warm red error segment.

### Neutral

Warm canvas, white panels, muted text, and fine lines provide the structure. Navigation selection is a pale neutral pill with dark text. Success and error pair tinted surfaces with readable labels and dots; trace types retain blue, purple, and amber accents.

## Typography

Inter Variable loads its optical-size face, with `font-optical-sizing: auto` and synthesis disabled. Headlines use tight tracking; panel titles use a compact medium weight. Controls and tables generally use 12px; secondary labels use 10–11px. Numeric data uses tabular figures; run IDs use monospace. Metric supporting labels and chart dates remain 10px; failed counts use 11px on mobile. The decorative OC mark, code type badges, and mobile footer retain deliberate 9px micro-label exceptions.

At 900px and below, metrics use 28px; at 600px and below, they use 25px and the page heading uses 30px. Mobile fields use 16px. Final trace output preserves whitespace with a 75ch maximum measure.

## Layout

Desktop uses a fixed 232px sidebar and matching content offset. Content is centered within 1512px, with 40px horizontal padding, a 65px sticky topbar, and 24px panel spacing. Filters use five columns; metrics form one six-column divided strip. Analytics use a 1.15:1 split with a 24px gap.

| Width | Adaptation |
| --- | --- |
| At least 1700px | Main top padding becomes 44px. |
| Up to 1200px | Sidebar/offset become 204px; main and topbar use 24px padding; filters become two columns; header actions wrap. |
| Up to 900px | Sidebar enters normal flow, navigation scrolls horizontally, topbar becomes 48px, and metrics form three columns. |
| Up to 600px | Main uses 24px 16px padding; header and analytics stack; advanced fields use one column; panels use 18px 16px padding; controls and navigation have a 44px minimum height. |

The page supports 320px width. Desktop data panels have a 428px maximum scroll height. On mobile, the trace list grows to its full content height and scrolls horizontally only; retain intact table columns. The waterfall has a 680px minimum grid and its own horizontal scroller, with 24px nesting indentation.

## Elevation & Depth

Use shallow, precise layers. Panels combine a fine outline shadow with a nearly imperceptible lower shadow; the metric strip uses an outline shadow. Charcoal actions have a light inset highlight, short lower shadow, and dark edge. White secondary actions use the same layered construction with softer neutral edges. Avoid broad floating-card shadows.

Sidebar and topbar retain restrained structural blur. Select and calendar popups use a near-opaque white surface, 16px blur, a fine outline, and compact floating shadows. Reduced transparency removes their blur; increased contrast strengthens text, borders, and field outlines. Exact shadow recipes live in the sidecar.

## Shapes

Panels and filters use softly fitted corners (16px); actions and navigation selection use 9px, fields 8px, and status labels 6px. The mobile metric strip uses 12px. Outline icons share round caps and joins with a 1.7 stroke on a 24-unit viewBox; standard icons render at 20px and action icons at 15px.

## Components

- **Actions:** Layered charcoal primary and white secondary buttons. The primary action keeps a solid charcoal base beneath a constant translucent gradient; hover transitions the base color without replacing the gradient, avoiding a hover flash. Hover changes fill or edge depth; enabled press scales to .97. Run links and disclosure triggers skip the press transform. Disabled buttons use .48 opacity and a waiting cursor. Apply, refresh, export, and copy labels change over 160ms with a small vertical move and crossfade.
- **Fields:** Visible labels, warm fill, fine neutral border, and an inset shadow. Hover darkens the border. Field focus turns the fill white with a blue border and subtle 3px halo; other keyboard targets retain a visible 3px outline.
- **Selects:** Base UI Select powers saved-view and status controls. Warm triggers retain the field border and focus halo; an open trigger rotates its chevron. Portaled menus align to the trigger with collision padding, 5px inset padding, 36px options, neutral highlighted rows, and blue selected checkmarks. Options become 44px on mobile. Preserve library keyboard navigation, selection, dismissal, and focus return.
- **Calendar:** Base UI Popover hosts a styled react-day-picker single-date calendar. From sets the latest allowed day from To; To sets the earliest allowed day from From. Bounds constrain both month navigation and selectable days. Dates parse at local midnight and serialize to local `YYYY-MM-DD`, avoiding UTC day shifts. Selection, Clear, and Today close the popup and return focus to its trigger; Today disables outside the bounds. Calendar focus starts inside the popup and arrow keys move between days. The desktop popup is 286px wide with 14px padding, 36px day cells, and charcoal selected days; mobile expands up to 330px with larger navigation targets. Popups enter and exit over 120ms with a small translate/scale and opacity change.
- **Navigation:** A persistent white selection slides between anchors with a 280ms transform transition. Manual scrolling updates selection without fetching data; programmatic navigation holds the selected destination during its scroll. Pointer activation starts a 280ms imperative scroll with `cubic-bezier(0.23, 1, 0.32, 1)`; wheel, touch, pointer, or key input interrupts it. Keyboard activation and reduced motion scroll instantly; keyboard activation also moves focus to the section destination without additional scrolling. Section anchors update the hash without fetching data. Labels and outline icons stay still. Trace count appears as a small neutral badge on desktop and hides below 900px.
- **Disclosure and inspector:** A button with `aria-expanded` controls the event-type field with a CSS height transition over 160ms with `cubic-bezier(0.23, 1, 0.32, 1)`, measured by ResizeObserver, without an opacity fade; hidden content is inert and marked `aria-hidden`. Advanced disclosure state stays local to a memoized component, while stable select options/callbacks and a memoized trace table avoid unrelated rerenders. Event metadata inside the waterfall retains its own native detail disclosure.
- **Data panels:** Five requests resolve independently. First loads use metric placeholders and section skeleton lines with a 1400ms opacity breathing cycle; reduced motion makes them static. Apply and Refresh show waiting labels and indicators while sections load; the request status reports progress across the five independent requests. Refreshing the same query keeps prior results visible with an updating indicator; errors explicitly identify previous results as stale and provide retry guidance. Applying a changed query clears old results and closes the inspector. Trace-request sequencing prevents late responses from reopening a closed or replaced trace. Metrics, rows, and chart geometry never animate on arrival.
- **Trace table:** Sticky headings, right-aligned numbers, subtle hover, and a pale selected row. Keyboard-accessible run buttons announce selection; closing the inspector restores focus. The opening run shows a row-level loader and the open inspector shows Updating while details load. Copy shows Copying while awaiting the clipboard, then a visible success or failure label. Export shows Preparing through fetch and blob creation, downloads the resulting file, and reports a visible retryable failure.
- **Status and charts:** Text accompanies every colored status. Run-volume columns expose count, date, and failed count; failure labels remain 10px on desktop and 11px on mobile.

Input-mode attributes and React keyboard state update only when the mode changes. Keyboard input and reduced-motion preference set both CSS and Motion transitions to zero; reduced motion also removes spinning indicators and press transforms. A visible-on-focus skip link leads to the dashboard. Preserve explicit stale/error text and preference support in new components.

## Do's and Don'ts

- **Do** use optical Inter, aligned tabular numbers, neutral selection, and the existing layered action recipes.
- **Do** retain local horizontal scrolling, visible labels, focus return, inert hidden regions, and independent section states.
- **Do** keep state changes brief, interruptible, and free of bounce.
- **Don't** reintroduce blue filled primary actions or an Apple-led visual direction.
- **Don't** animate data, shrink metric supporting labels or chart dates below 10px, or present stale results as current.


## Investigation workflow

- Filter fields are drafts until Apply. A visible pending state and Reset restore the applied draft. Refresh resolves the applied range again (rolling windows move forward), keeps prior results visible while loading, and never applies pending edits. Export uses the same applied query as the displayed results. Applying a different filter selection clears prior results and closes trace details.
- The header time picker offers All time, Last 24 hours, Last 7 days, Last 30 days, and Custom. Custom calendars use linked bounds; query timestamps cover local start-of-day through end-of-day, serialized to ISO. Saved views set a visible 30-day preset without putting stale time descriptions into their labels.
- The Base UI trace inspector is non-modal on desktop so the table remains usable, and modal/full-screen at 900px and below. It slides from the right over 260ms, with zero motion for keyboard input or reduced motion. Desktop width can be adjusted with a captured pointer or arrow keys on the resize separator. Previous/Next inspect loaded runs. Escape/Close return focus to the selected run. Skeletons, errors, retry, and request sequencing preserve the requested identity and prevent reopening after close.
- Run IDs retain both ends, with a dedicated copy action and visible copied/failure icon. Timestamps use a compact two-line format, exposing full date/time/timezone on hover or keyboard focus.
- Waterfalls provide a five-tick elapsed-time ruler, hover/focus timing details, and individually collapsible branches. Copy nested trace is a secondary action. Data geometry never animates on arrival.

Small state transitions: Custom date fields enter with a 150ms ease-out opacity/3px translate transition. The pending-filter status reserves its layout slot and fades over 120ms; its hidden Reset action is inert and aria-hidden. Copy-ID glyphs occupy the same 12px box and crossfade over 120ms. Keyboard input remains instant. Reduced motion uses 80ms opacity-only transitions. Browser frame samples verified intermediate opacity/translation, unchanged metric position, successful clipboard content, hidden Reset inertness, and no document overflow at 390px.