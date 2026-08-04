# Omega Helper

SillyTavern third-party extension that syncs **Chat Completion** feature prompts (JB/Omega OAI preset) with their **preset-embedded regex**.

**Version:** 1.2.0 (see `manifest.json`)  
**Author:** Zealllll

## Design rules
- Uses only SillyTavern core APIs:
  - `/scripts/openai.js` → Prompt Manager (`prompt_order` on/off)
  - `/scripts/extensions/regex/engine.js` → preset/global/scoped regex
- Does **not** depend on Prompt Peek, Tavern Helper, or any other third-party extension
- Works for anyone who only installs this folder + loads an Omega-style OAI preset

## What a “feature” is
One row = the JB prompt that teaches the model to emit a block **plus** the regex scripts that render/cut that block.

Example: toggle **Lust Score** off → disables the Lust Score completion prompt *and* Lust Score regex/cut-off scripts together.

## Install (local folder)
Copy / clone this repo into:

```text
SillyTavern/public/scripts/extensions/third-party/SillyTavern-OmegaHelper/
```

Required files: `manifest.json`, `index.js`, `style.css`.

1. Restart ST / reload extensions
2. Enable **Omega Helper**
3. Ctrl+F5
4. Load Gemini Omega (Chat Completion preset)
5. Allow preset regex if ST asks (button in panel)

### Install from private GitHub (VPS / another machine)
Use a machine that can auth to the private repo (SSH key or HTTPS token with `repo` scope):

```bash
# SSH (recommended once keys are set)
cd /path/to/SillyTavern/public/scripts/extensions/third-party
git clone git@github.com:OWNER/SillyTavern-OmegaHelper.git

# or HTTPS
git clone https://github.com/OWNER/SillyTavern-OmegaHelper.git
```

Then restart ST, enable the extension, hard-refresh the browser.

Update later:
```bash
cd /path/to/SillyTavern/public/scripts/extensions/third-party/SillyTavern-OmegaHelper
git pull
```

## UI
- Bolt button next to Send / Wand menu / Extensions drawer
- Feature packs (primary)
- Advanced: raw regex list (optional)
- Profiles: save/load combined prompt+regex on/off sets (stored in this extension’s settings only)

## Reasoning watchdog (v1.2)
Two checks, both surfaced as in-page popup cards (top-right, dismissable, with action buttons):

**1. Truncated reasoning / missing regex** — after each reply (and swipe) the last
assistant message is scanned for:
- reasoning prefix without its suffix → the block never closed
- a complete `prefix…suffix` pair still visible in chat → Auto-Parse off or template mismatch
- Omega UI tags left unpaired (e.g. `<LustScore>` with no closer) → regex render/cut incomplete

**2. Reasoning Formatting vs model** — `Advanced Formatting → Reasoning Formatting`
plus `Start Reply With` are matched against the selected Gemini model:

| Model | Start Reply With | Show reply prefix in chat |
|-------|------------------|---------------------------|
| gemini 3.5 flash / 3.1 pro and older | reasoning prefix (e.g. `<planning>`) | checked |
| gemini 3.5 flash-lite, 3.6+ (any variant) | empty | unchecked |

Non-Gemini models are skipped. `แก้ให้เลย` on the popup (or `/oh-fix`) applies the
rule and mirrors the native controls. Optional auto-fix in settings.

Only active on **Omega / 5EX** presets. Other presets (NemoEngine, Claude JB, …) are
skipped entirely — no checks, no popups, and `fix()` refuses to touch their settings.

`<planning>` / `</planning>` is a hard contract: both Reasoning Formatting fields get it
under **both** model rules. Only Start Reply With differs.

## Verify

```bash
node selfcheck.mjs   # static CSS/source contracts + headless runtime assertions
```

## Slash
- `/omega` open panel
- `/oh-feat Lust off` toggle feature by name
- `/oh-on` / `/oh-off` regex by name (advanced)
- `/oh-check` audit Reasoning Formatting against the current model
- `/oh-fix` apply the rule for the current model

## Notes
- Keyword matching — works across Omega versions without hardcoding every UUID
- Soft-merge profiles: unknown new prompts/regex stay as-is
- Chat reload after toggle updates rendered UI cards

## Repo layout
```text
SillyTavern-OmegaHelper/
  manifest.json
  index.js
  style.css
  README.md
  .gitignore
```
