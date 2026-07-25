# Omega Helper

SillyTavern third-party extension that syncs **Chat Completion** feature prompts (JB/Omega OAI preset) with their **preset-embedded regex**.

**Version:** 1.1.1 (see `manifest.json`)  
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

## Slash
- `/omega` open panel
- `/oh-feat Lust off` toggle feature by name
- `/oh-on` / `/oh-off` regex by name (advanced)

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
