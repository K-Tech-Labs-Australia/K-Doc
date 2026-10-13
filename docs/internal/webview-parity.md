---
audience: internal
title: Webview Parity — OQ-9
status: partial
doc_version: 1
last_updated: 2026-09-04
---

# Webview Parity — OQ-9

**Question:** K-Doc ships on Tauri, so its UI runs in whatever webview the OS provides. Rendering
differences between those are cosmetic; *editing* differences are not, because ProseMirror sits
directly on `contenteditable`, `beforeinput`, and the Selection APIs. Which engine sets the floor,
and what is the contingency if one of them cannot host the K-Doc pane?

**Status:** Chromium answered and green. WKWebView and WebKitGTK **not yet run** — they need macOS
and Linux hosts, which were not available when this was written. The instrument is built and
portable; running it elsewhere is a five-minute job (§4).

---

## 1. Verdict so far

| Engine | Platform | Automated probes | Live input | ProseMirror | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Chromium 148** | Windows 11 | 19 pass, 0 fail, 2 manual, **0 critical failures** | PASS | Edits correctly | **Green** |
| **WKWebView** | macOS | not run | not run | not run | **Unknown** |
| **WebKitGTK** | Linux | not run | not run | not run | **Unknown** |

Chromium is the engine WebView2 is built on, so the Windows target is effectively answered. It is
*not* a proxy for the other two, and must not be reported as one.

### Chromium evidence

```
beforeinput   inputType="insertText"   targetRangeCount=1   isTrusted=true
ProseMirror   transactions dispatched: 2
editor text   "Type Zhere. Bold wit…"   (Z inserted at the caret)
```

`isTrusted: true` is the load-bearing field. It proves the observation came from the **native input
pathway** rather than a synthesised event, which is the only thing that actually answers the
question. `targetRangeCount=1` proves `getTargetRanges()` returns usable ranges — the API ProseMirror
depends on to know what a keystroke is about to change.

---

## 2. A defect this spike found in itself

The first run reported **1 critical failure**: `beforeinput` did not fire. That was wrong, and the
way it was wrong is worth recording, because the same trap will catch the next person.

The probe triggered input with `document.execCommand('insertText', false, 'X')`. Measured on
Chromium 148, with the editable host focused (`document.activeElement === host` confirmed true) and
a collapsed selection correctly placed:

- `execCommand` returned `true`
- the text **did** change — `ab` became `aXb`
- **no `beforeinput` event fired at all**

The same result was obtained with the host both on-screen and off-screen, ruling out a focus or
visibility artefact. `execCommand` simply bypasses the `beforeinput` pathway in Chromium.

**The instrument was reporting a critical engine failure that did not exist.** A capability probe
that lies in the *pessimistic* direction is worse than no probe: it would have sent us to build a
bundled-Chromium contingency for a platform that never needed one.

The fix: `beforeinput-fires` is now honestly reported as `manual`, `get-target-ranges` became a
static capability check, and the behavioural question moved to the live-input panel, which records
only genuine `isTrusted` events.

---

## 3. What cannot be automated

**IME composition** is the highest-risk item in OQ-9 and there is no way around a human. Composition
handling is where webview editing implementations diverge most, and it cannot be exercised
programmatically — synthesised composition events do not go through the engine's real IME path.

The harness therefore ships a manual IME area that logs `compositionstart` / `compositionupdate` /
`compositionend` with their `data` payloads. Someone must sit down with a real input method
(Pinyin, Kotoeri, or a dead-key Latin layout) and watch the sequence. **This is still outstanding on
every engine, Chromium included.**

---

## 4. How to run this on another engine

```bash
git clone https://github.com/K-Tech-Labs-Australia/K-Doc.git && cd K-Doc
npm install
npm run dev -w @k-doc/app     # serves on http://localhost:5173
```

Open that URL in the engine under test — Safari for WKWebView, Epiphany or any WebKitGTK browser for
WebKitGTK — then:

1. Read the banner. **Critical failures is the number that matters.**
2. Type one character into the ProseMirror box. The live-input panel must go PASS, and the
   transaction counter must rise.
3. Type into the IME box with a real input method and check the composition sequence.
4. Press **Copy report as Markdown** and paste the result into this file as a new section.

The probe module (`packages/app/src/probe/webview-probe.ts`) imports nothing and touches no K-Doc
code, so it can also be lifted into a bare page on a machine that has none of this project.

To run inside the real Tauri host rather than a browser:

```bash
npx tauri dev
```

The harness detects the Tauri global and writes its report to `docs/webview-parity-webview2.md`
through the `save_probe_report` Rust command.

---

## 5. Contingency, if an engine fails

Not needed for Chromium. Recorded now so the decision is not made under pressure later:

1. **Non-critical failures** — implement the documented fallback. `contentEditable="plaintext-only"`
   is the likely one; its absence means the Source pane sanitises paste itself.
2. **Critical failure in the input pipeline** (`beforeinput` or `getTargetRanges`) — the K-Doc pane
   cannot be hosted on that engine. Two options, in order of preference: ship a bundled Chromium on
   that platform only, accepting the binary-size cost there; or degrade that platform to Source-only
   with the rendered Preview pane, which is a genuinely useful product but not the product.
3. **IME-only failure** — ship, and gate the affected input methods behind a warning. A document
   editor that mangles Japanese input is not shippable in that locale, but it is shippable elsewhere.

---

## 6. Open

- [ ] Run on WKWebView (macOS)
- [ ] Run on WebKitGTK (Linux)
- [ ] Manual IME pass on all three, including Chromium
- [ ] Run inside `tauri dev` on Windows to confirm WebView2 matches plain Chromium
