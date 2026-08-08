#!/usr/bin/env node
/* Omega Helper self-check — the canonical verification command for this extension.
 *   node selfcheck.mjs
 * No deps, no framework. Two halves:
 *   STATIC   — style.css / index.js contracts (state colours, perf budget)
 *   RUNTIME  — boots the real index.js headless against stub ST modules
 * Exits non-zero on the first broken contract. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
const raw = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));

let fail = 0;
const ok = (name, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) fail += 1;
};

// ============================== STATIC ==============================
console.log('STATIC 1) state selectors the JS relies on');
for (const sel of ['.oh-row.is-on', '.oh-row.is-off', '.oh-row.is-partial',
    '.oh-toggle input:checked', '.oh-toggle input:indeterminate', '.oh-toggle.busy']) {
    ok(`styled ${sel}`, css.includes(sel));
}

console.log('STATIC 2) OFF state carries no accent colour');
ok('is-off rail transparent', /\.oh-row\.is-off[^}]*border-left-color:\s*transparent/s.test(css));
ok('is-off badges neutralised', /\.oh-row\.is-off \.oh-badge[^}]*color:\s*var\(--oh-text\)\s*!important/s.test(css));
ok('off track + knob grey', /--oh-off:\s*#4a4a4f/.test(css) && /--oh-off-knob:\s*#9a9aa0/.test(css));
ok('regex badge not amber', !/\.oh-badge\.regex[^}]*#f0c98a/s.test(css));

console.log('STATIC 3) low-spec perf budget');
const props = [...css.matchAll(/transition:\s*([^;]+);/g)]
    // drop parenthesised groups first: cubic-bezier(a, b, c, d) would split into junk
    .flatMap((m) => m[1].replace(/\([^)]*\)/g, '').split(',').map((s) => s.trim().split(/\s+/)[0]))
    .filter((p) => p && p !== 'none' && !p.startsWith('!'));
const cheap = ['transform', 'opacity', 'background-color', 'border-color', 'color'];
const costly = [...new Set(props)].filter((p) => !cheap.includes(p));
ok('only compositor/paint transitions', costly.length === 0, costly.join(',') || 'clean');
ok('no color-mix() (old WebViews)', !css.includes('color-mix('));
ok('no backdrop-filter', !/backdrop-filter\s*:/.test(css));
ok('no box-shadow/filter/all animation', !/transition:[^;]*(box-shadow|filter|\ball\b)/.test(css));
ok('group list content-visibility', /\.oh-group\b[^}]*content-visibility:\s*auto/s.test(css));
ok('reduced-motion block', css.includes('prefers-reduced-motion'));
ok('hover:none block (sticky hover)', css.includes('(hover: none)'));
ok('40px tap token', /--oh-tap:\s*40px/.test(css));
ok('mobile footer uses compact 2-column grid',
    /@media \(max-width:\s*768px\)[\s\S]*#oh-panel-footer[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,/m.test(css));

console.log('STATIC 4) source contracts');
ok('planning template constant', /REASONING_TEMPLATE = \{ prefix: '<planning>', suffix: '<\/planning>' \}/.test(raw));
ok('fix() writes #reasoning_prefix', raw.includes("$('#reasoning_prefix').val(REASONING_TEMPLATE.prefix)"));
ok('fix() writes #reasoning_suffix', raw.includes("$('#reasoning_suffix').val(REASONING_TEMPLATE.suffix)"));
ok('Omega/5EX gate present', raw.includes('SUPPORTED_PRESET'));
ok('watch popup is immediate', /cooldown: 0, \/\/ think broken/.test(raw));
for (const cls of ['oh-row', 'oh-toggle', 'oh-slider', 'oh-badge', 'oh-alert', 'oh-tab']) {
    ok(`index.js emits .${cls}`, raw.includes(cls));
}
ok('alert setting id does not collide with popup host',
    raw.includes('id="oh-alerts-enabled"') && !/<input[^>]+id="oh-alerts"/.test(raw));
ok('search rendering is debounced', /_searchTimer\s*=\s*setTimeout\([\s\S]*?this\.render\(\);[\s\S]*?140\);/.test(raw));
ok('generation waits for required Sigil prompts',
    /GENERATION_STARTED[\s\S]*async \(_type, _opts, dryRun\)[\s\S]*await RequiredPrompts\.enforce\(\)/.test(raw));
ok('group changes are batched', /async setGroup[\s\S]*this\.setPacks\(subset, enabled/.test(raw));
ok('current Omega patch notice is bundled',
    raw.includes("id: 'gemini-omega-2.4.2-2026-06-07'")
    && raw.includes('1512886868872659146'));
ok('patch version is checked once during boot', /function boot\(\)[\s\S]*boot\.done[\s\S]*PatchNotice\.check\(\)/.test(raw));
ok('patch version rechecks after preset change', /OAI_PRESET_CHANGED_AFTER[\s\S]*await PatchNotice\.check\(\)/.test(raw));
ok('mixed state uses an actionable Thai label',
    raw.includes("pack.state === 'partial' ? 'เปิดให้ครบ'") && !raw.includes('>เปิดบางส่วน<'));
ok('mixed switch deterministically completes the feature',
    /nextEnabled\s*=\s*pack\.state === 'partial' \? true/.test(raw));
ok('feature categories come from preset section headers',
    raw.includes('assignPresetSections') && raw.includes('sectionTitle(prompt.name)') && !raw.includes('GROUP_META'));
ok('decorative divider lines split preset groups',
    raw.includes('isDivider(prompt.name)') && raw.includes('sectionDivider: true'));
ok('prompt list preserves prompt_order', raw.includes('orderedPrompts.push({ ...prompt, orderIndex })'));
ok('single feature toggle does not full-refresh the panel',
    /const pending = Features\.setPack\([\s\S]*?this\.syncPackRow\(row, pack\);[\s\S]*?await pending/.test(raw));
ok('prompt state mutates before background persistence',
    /prompt\.enabled = !!enabled[\s\S]*await Prompts\.setEnabled/.test(raw)
    && raw.includes('void this.queueSave(pm, render)'));
ok('native Prompt Manager rows sync without a full render',
    raw.includes("'[data-pm-identifier]'")
    && raw.includes("this.syncNativeEnabled(pm, ids, enabled)")
    && raw.includes("toggle?.classList.toggle('fa-toggle-on', !!enabled)"));
ok('regex persistence does not block its live toggle',
    raw.includes('void this.queueSave(type)')
    && /const pending = Engine\.setEnabled\([\s\S]*?void Engine\.reloadChatIfNeeded\(\)/.test(raw));
ok('prompt rows are not merged by feature keywords',
    raw.includes('One real prompt = one row') && !/for \(const def of FEATURE_DEFS\)/.test(raw));
ok('prompt and regex controls are separate', !raw.includes('id="oh-sync-mode"'));
ok('custom prompt rows expose an edit button',
    raw.includes('oh-row-edit') && raw.includes('this.openPromptEditor(pack)'));
ok('custom prompt edits are saved to the original prompt object',
    /async update\(identifier,[\s\S]*prompt\.content = cleanContent[\s\S]*saveServiceSettings/.test(raw));
ok('system prompts are protected from inline edits',
    raw.includes('prompt.marker || prompt.system_prompt'));
ok('custom prompt editor is styled for phones',
    css.includes('.oh-prompt-editor') && /@media \(max-width:\s*768px\)[\s\S]*\.oh-prompt-editor-card/.test(css));
ok('interactive panel controls use native buttons',
    raw.includes('<button type="button" class="oh-tab')
    && raw.includes('<button type="button" class="menu_button menu_button_icon" id="oh-close"'));
ok('dialog restores focus and traps keyboard focus',
    raw.includes('opener?.isConnected && opener.focus?.()') && raw.includes("e.key === 'Tab' && this.isOpen"));
ok('minimum client version covers preset regex API', manifest.minimum_client_version === '1.13.5');
ok('extension versions stay in sync', manifest.version === '1.3.0'
    && raw.includes("const VERSION = '1.3.0'"));
ok('profile apply previews changes and exposes one-step undo',
    raw.includes('async preview(id)') && raw.includes('async undoLast()')
    && raw.includes('id="oh-profile-undo"') && raw.includes('window.confirm?.(lines.join'));
ok('panel refreshes coalesce and load independent state in parallel',
    raw.includes('_refreshQueued = true')
    && /Promise\.all\(\[\s*Features\.resolve\(\),\s*Engine\.isPresetAllowed\(\),\s*Prompts\.getOaiName\(\)/.test(raw));
ok('UI retry stops when requested controls are ready', /if \(ready \|\| tries >= 40\) clearInterval\(timer\)/.test(raw));
ok('mutation checks are batched to one animation frame',
    /new MutationObserver[\s\S]*if \(uiFrame\) return;[\s\S]*requestAnimationFrame/.test(raw));

// ============================== RUNTIME ==============================
const noop = () => {};
const dataUrl = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');

const power_user = {
    user_prompt_bias: '<planning>', show_user_prompt_bias: true,
    reasoning: { prefix: '<planning>', suffix: '</planning>', auto_parse: true, separator: '' },
};
let model = 'gemini-3.5-flash';
let presetName = 'Gemini Omega 4.2';
const requiredPromptNames = [
    'Sigil Fence Cut (Display)', 'Sigil Clock Cut (Display)', 'Sigil Stage Cut (Display)',
    'Sigil Facts Cut (Display)', 'Sigil Normalize CLK (Prompt)', 'Sigil Normalize STG (Prompt)',
    'Sigil Normalize FACT (Prompt)', 'Sigil Trim CLK (Prompt)', 'Sigil Trim STG (Prompt)',
    'Sigil Trim FACT (Prompt)', 'Sigil Auto-Fence Wrap (Prompt)', 'Sigil Fence Cut-off (Prompt)',
    'Sigil Clock Cut-off (Prompt)', 'Sigil Stage Cut-off (Prompt)', 'Sigil Facts Cut-off (Prompt)',
];
globalThis.__PROMPTS__ = [
    ...requiredPromptNames.map((name, i) => ({ identifier: `sigil-${i}`, name })),
    { identifier: 'heading-format', name: '👇| **Format** (รูปแบบ) ↴' },
    { identifier: 'feature-aether', name: 'Aether (World Expansion)' },
    { identifier: 'divider-format', name: '─── ⋆⋅☆⋅⋆ ───── ⋆⋅☆⋅⋆ ──── 4' },
    { identifier: 'feature-nexus', name: '(UI) Nexus UI' },
    { identifier: 'feature-lust', name: 'Lust Score' },
];
globalThis.__ORDER__ = [
    ...requiredPromptNames.map((_, i) => ({ identifier: `sigil-${i}`, enabled: false })),
    { identifier: 'heading-format', enabled: true },
    { identifier: 'feature-aether', enabled: true },
    { identifier: 'divider-format', enabled: true },
    { identifier: 'feature-nexus', enabled: false },
    { identifier: 'feature-lust', enabled: true },
];
globalThis.__REGEX__ = [{ id: 'regex-lust', scriptName: 'Lust Score', disabled: false, __type: 'preset' }];
globalThis.__PM_SAVES__ = 0;
globalThis.__PM_RENDERS__ = 0;
globalThis.__REGEX_SAVES__ = 0;
globalThis.__PU__ = power_user;
Object.defineProperty(globalThis, '__MODEL__', { get: () => model });
Object.defineProperty(globalThis, '__PRESET__', { get: () => presetName });

const stub = {
    openai: dataUrl(`
export const oai_settings = { get preset_settings_openai(){ return globalThis.__PRESET__; } };
export function getChatCompletionModel(){ return globalThis.__MODEL__; }
export const promptManager = { configuration:{promptOrder:{dummyId:100001}}, activeCharacter:{id:100001},
  serviceSettings:{prompts:globalThis.__PROMPTS__,prompt_order:[{character_id:100001,order:globalThis.__ORDER__}]},
  saveServiceSettings(){globalThis.__PM_SAVES__++}, render(){globalThis.__PM_RENDERS__++} };`),
    engine: dataUrl(`
export const SCRIPT_TYPES = { PRESET:'preset', GLOBAL:'global', SCOPED:'scoped' };
export function getScriptsByType(type){return globalThis.__REGEX__.filter(s=>s.__type===type)}
export function saveScriptsByType(){globalThis.__REGEX_SAVES__++}
export function getCurrentPresetAPI(){return'openai'} export function getCurrentPresetName(){return globalThis.__PRESET__}
export function isPresetScriptsAllowed(){return true} export function allowPresetScripts(){}`),
    powerUser: dataUrl('export const power_user = globalThis.__PU__;'),
};

// Minimal DOM. querySelector MUST resolve children: Alerts.show() writes into
// .oh-alert-title / .oh-alert-body, so returning null is a harness defect, not a bug.
const el = () => ({
    id: '', className: '', style: {}, innerHTML: '', textContent: '', title: '', dataset: {}, hidden: false,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
    replaceChildren: noop, children: [], isConnected: true,
    querySelector: (s) => (String(s).startsWith('.oh-alert[') ? null : el()), querySelectorAll: () => [],
});
global.window = global;
global.document = { body: el(), hidden: false, getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], createElement: el, createDocumentFragment: el, addEventListener: noop };
global.MutationObserver = class { observe() {} disconnect() {} };
global.toastr = { success: noop, info: noop, error: noop, warning: noop };
global.CSS = { escape: String };
global.requestAnimationFrame = (f) => f();
global.setInterval = () => 0;
global.clearInterval = noop;
const realTimeout = global.setTimeout;
global.setTimeout = (f, ms) => (ms > 50 ? 0 : realTimeout(f, 0)); // skip the 4s boot audit
const wrote = {};                                                 // capture fix()'s DOM writes
global.$ = (sel) => ({
    val: (v) => { if (v !== undefined) wrote[sel] = v; },
    prop: (_k, v) => { wrote[sel] = v; },
    length: 0, on: noop, before: noop, append: noop, find: () => ({ last: () => ({ text: noop }) }),
});
// ONE stable context object, else extensionSettings writes evaporate between calls
const ctx = { extensionSettings: {}, saveSettingsDebounced: noop, reloadCurrentChat: async () => {},
    chat: [], eventSource: { on: noop }, event_types: {} };
global.SillyTavern = { getContext: () => ctx };

const src = raw
    .replace("'/scripts/openai.js'", `'${stub.openai}'`)
    .replace("'/scripts/extensions/regex/engine.js'", `'${stub.engine}'`)
    .replace("'/scripts/power-user.js'", `'${stub.powerUser}'`)
    .replace(/    onReady\(\);\r?\n\}\)\(\);/, '    globalThis.__OH__ = { Doctor, Watch, Core, Alerts, RequiredPrompts, Features, Profiles, PatchNotice, Panel };\n    onReady();\n})();');
if (!src.includes('globalThis.__OH__ =')) {
    console.error('test hook rewrite matched nothing — runtime assertions would be vacuous');
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-selfcheck-'));
const boot = path.join(tmp, 'boot.mjs');
fs.writeFileSync(boot, src);
try {
    await import(pathToFileURL(boot).href);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
if (!globalThis.__OH__) { console.error('runtime test hook was not installed'); process.exit(1); }
const { Doctor, Watch, Core, Alerts, RequiredPrompts, Features, Profiles, PatchNotice, Panel } = globalThis.__OH__;
Object.assign(Core.getSettings(), { enabled: true, checkFormatting: true, watchReasoning: true, alerts: true });
const issueIds = async () => (await Doctor.check()).issues.map((i) => i.id).sort();

console.log('RUNTIME 1) model classification (parsed version, not a hardcoded list)');
const cls = (m) => Doctor.classify(m).rule?.id ?? null;
for (const [m, want] of [['gemini-3.5-flash', 'prefill'], ['gemini-3.1-pro-preview', 'prefill'],
    ['gemini-2.5-pro', 'prefill'], ['gemini-3.1-flash-lite', 'prefill'],
    ['gemini-3.5-flash-lite', 'noPrefill'], ['gemini-3.6-flash', 'noPrefill'],
    ['gemini-4.0-pro', 'noPrefill'], ['claude-3-5-sonnet', null]]) {
    ok(`${m} → ${want}`, cls(m) === want, String(cls(m)));
}

console.log('RUNTIME 2) Omega/5EX preset gate');
for (const [p, want] of [['Gemini Omega 4.2', true], ['Omega', true], ['5EX', true], ['5 EX v2', true],
    ['NemoEngine 6', false], ['Claude Sonnet JB', false], ['', false]]) {
    presetName = p;
    ok(`"${p || '(empty)'}" → ${want}`, (await Doctor.isSupportedPreset()).supported === want);
}

console.log('RUNTIME 3) unsupported preset is fully inert');
presetName = 'NemoEngine 6';
power_user.reasoning.prefix = 'WRONG';
power_user.user_prompt_bias = 'junk';
const inert = await Doctor.check();
ok('no issues', inert.issues.length === 0);
ok('no rule', inert.rule === null, String(inert.why));
let threw = false;
try { await Doctor.fix(); } catch (_) { threw = true; }
ok('fix() throws', threw);
ok('power_user untouched', power_user.reasoning.prefix === 'WRONG');
ok('Watch.run() → null', (await Watch.run()) === null);

console.log('RUNTIME 4) <planning> enforced in BOTH textareas');
presetName = 'Gemini Omega 4.2';
power_user.reasoning.prefix = '<think>';
power_user.reasoning.suffix = '</think>';
ok('wrong template flagged', (await issueIds()).includes('template'), JSON.stringify(await issueIds()));
await Doctor.fix();
ok('power_user prefix', power_user.reasoning.prefix === '<planning>', power_user.reasoning.prefix);
ok('power_user suffix', power_user.reasoning.suffix === '</planning>', power_user.reasoning.suffix);
ok('#reasoning_prefix written', wrote['#reasoning_prefix'] === '<planning>', String(wrote['#reasoning_prefix']));
ok('#reasoning_suffix written', wrote['#reasoning_suffix'] === '</planning>', String(wrote['#reasoning_suffix']));
ok('clean after fix', (await issueIds()).length === 0, JSON.stringify(await issueIds()));

console.log('RUNTIME 5) template constant across rules; only Start Reply With differs');
for (const [m, srw, show] of [['gemini-3.5-flash', '<planning>', true],
    ['gemini-3.6-flash', '', false], ['gemini-3.5-flash-lite', '', false]]) {
    model = m;
    await Doctor.fix();
    ok(`${m}: SRW=${JSON.stringify(srw)} show=${show}`,
        power_user.user_prompt_bias === srw && power_user.show_user_prompt_bias === show,
        JSON.stringify(power_user.user_prompt_bias));
    ok(`${m}: template still <planning>`,
        power_user.reasoning.prefix === '<planning>' && power_user.reasoning.suffix === '</planning>');
}

console.log('RUNTIME 6) broken think pops instantly, never suppressed');
model = 'gemini-3.5-flash';
await Doctor.fix();
ctx.chat = [{ is_user: false, is_system: false, mes: '<planning>cut off mid thought' }];
ok('1st reply reports', (await Watch.run())?.some((p) => p.id === 'thinkUnclosed'));
ok('2nd back-to-back also reports', (await Watch.run())?.some((p) => p.id === 'thinkUnclosed'));
ok('alert registered', Alerts.shown.has('watch'));
ctx.chat = [{ is_user: false, is_system: false, mes: 'clean reply, no tags' }];
ok('clean reply clears', (await Watch.run()).length === 0);
power_user.reasoning.prefix = 'WRONG'; // detection must not depend on live settings
ctx.chat = [{ is_user: false, is_system: false, mes: '<planning>still detectable' }];
ok('detects via constant, not settings', (await Watch.run())?.some((p) => p.id === 'thinkUnclosed'));

console.log('RUNTIME 7) required Sigil prompts are enabled before every Omega generation');
ok('all 15 known Sigil prompts match', requiredPromptNames.every((name) => RequiredPrompts.matches(name)));
ok('unrelated prompt does not match', !RequiredPrompts.matches('Optional Sigil Theme (Prompt)'));
presetName = 'Gemini Omega 4.2';
const firstEnforce = await RequiredPrompts.enforce();
ok('first pass enables all 15', firstEnforce.changed === 15
    && globalThis.__ORDER__.filter((e) => e.identifier.startsWith('sigil-')).every((e) => e.enabled));
ok('first pass saves once without redrawing native manager',
    globalThis.__PM_SAVES__ === 1 && globalThis.__PM_RENDERS__ === 0);
const secondEnforce = await RequiredPrompts.enforce();
ok('clean pass performs no writes', secondEnforce.changed === 0
    && globalThis.__PM_SAVES__ === 1 && globalThis.__PM_RENDERS__ === 0);
presetName = 'NemoEngine 6';
globalThis.__ORDER__[0].enabled = false;
const skippedEnforce = await RequiredPrompts.enforce();
ok('non-Omega preset stays untouched', skippedEnforce.skipped && !globalThis.__ORDER__[0].enabled);

console.log('RUNTIME 8) preset prompts stay separate and follow preset sections');
const sectioned = Features.assignPresetSections([
    { identifier: 'heading-extension', name: '👇| **Extension** (เลือกฟีเจอร์) ↴', orderIndex: 10 },
    { identifier: 'lust', name: 'Lust Score', orderIndex: 11 },
    { identifier: 'heading-misc', name: '👇| **Miscellaneous** (โหมดอื่นๆ) ↴', orderIndex: 20 },
    { identifier: 'quest', name: 'Super Quest', orderIndex: 21 },
]);
ok('reads Extension/Miscellaneous from preset headings',
    sectioned[1].section.title === 'Extension' && sectioned[3].section.title === 'Miscellaneous');
ok('heading prompts are marked as structure', sectioned[0].sectionHeader && sectioned[2].sectionHeader);
ok('ornamental Tibetan divider is structure, not a prompt',
    Features.isDivider('⁺‧₊˚ ཐི⋆♱⋆ཋྀ ˚₊‧⁺ ⁺‧₊˚ ཐི⋆♱⋆ཋྀ ˚₊‧⁺'));
ok('real decorated prompt name is not a divider', !Features.isDivider('🌌──Aether (World Expansion)──⭐'));
presetName = 'Gemini Omega 4.2';
const lustOrder = globalThis.__ORDER__.find((e) => e.identifier === 'feature-lust');
const lustRegex = globalThis.__REGEX__[0];
Object.assign(Core.getSettings(), { reloadChatAfterToggle: false });
lustOrder.enabled = true;
lustRegex.disabled = false;
const resolvedPrompts = await Features.resolve();
let lustPack = resolvedPrompts.packs.find((pack) => pack.def.id === 'feature-lust');
const aetherPack = resolvedPrompts.packs.find((pack) => pack.def.id === 'feature-aether');
const nexusPack = resolvedPrompts.packs.find((pack) => pack.def.id === 'feature-nexus');
ok('Aether and Nexus are two independent rows',
    aetherPack?.prompts.length === 1 && nexusPack?.prompts.length === 1 && aetherPack !== nexusPack);
ok('divider starts a second real Format segment',
    aetherPack?.section.title === 'Format' && nexusPack?.section.title === 'Format · ส่วน 2');
ok('divider itself is not rendered as a Prompt row',
    !resolvedPrompts.packs.some((pack) => pack.def.id === 'divider-format'));
ok('one prompt row never inherits regex', lustPack.regex.length === 0 && lustPack.mode === 'prompt');
lustRegex.disabled = false;
await Features.setPack(lustPack, false, { reload: false, quiet: true });
ok('prompt toggle leaves Regex untouched', !lustOrder.enabled && !lustRegex.disabled);

console.log('RUNTIME 9) inspect() false-positive guards');
const T = { prefix: '<planning>', suffix: '</planning>' };
const ins = (t) => Watch.inspect(t, T).map((p) => p.id);
ok('html/markdown clean', ins('Reply <b>b</b> <i>i</i> <div><span>x</span></div>').length === 0, JSON.stringify(ins('<b>b</b>')));
ok('self-closing clean', ins('a<br/>b <img src="x"/>').length === 0);
ok('balanced omega tag clean', ins('<LustScore>72</LustScore>').length === 0);
ok('unpaired omega tag flagged', ins('<LustScore>72 text').includes('blockUnclosed'));
ok('leftover parsed block flagged', ins('<planning>x</planning> hi').includes('thinkNotParsed'));

console.log('RUNTIME 10) preset version parsing and comparison');
ok('parses Omega name before its date',
    JSON.stringify(PatchNotice.parseVersion('Gemini Omega 2.4.2 (7-6-26)')) === '[2,4,2]');
ok('parses two-part JB version', JSON.stringify(PatchNotice.parseVersion('Custom JB v3.1')) === '[3,1,0]');
ok('newer version compares above latest', PatchNotice.compare([3, 0, 0], [2, 4, 2]) > 0);
ok('same version compares equal', PatchNotice.compare([2, 4, 2], [2, 4, 2]) === 0);
ok('older version compares below latest', PatchNotice.compare([2, 4, 1], [2, 4, 2]) < 0);

console.log('RUNTIME 11) healthy patch state stays quiet');
let patchPopups = 0;
const realPatchShow = PatchNotice.show;
PatchNotice.show = () => { patchPopups += 1; return {}; };
presetName = 'Gemini Omega 2.4.2';
const healthyPatch = await PatchNotice.check();
ok('latest preset does not open a popup', patchPopups === 0 && healthyPatch.relation === 0);
presetName = 'Gemini Omega 2.4.1';
await PatchNotice.check();
ok('outdated preset opens one warning', patchPopups === 1);
presetName = 'Custom JB 1.0';
const skippedPatch = await PatchNotice.check();
ok('unrelated preset never compares against Omega', skippedPatch.skipped && patchPopups === 1);
PatchNotice.show = realPatchShow;

console.log('RUNTIME 12) profile import validates and apply reports drift');
const imported = Profiles.importData({
    format: 'omega-helper-profiles', version: 1, profiles: [{
        id: 'portable', name: 'Portable', promptOrder: [
            { identifier: 'feature-lust', enabled: true },
            { identifier: 'removed-prompt', enabled: true },
        ], regex: [
            { id: 'regex-lust', name: 'Lust Score', type: 'preset', enabled: false },
            { id: 'removed-regex', name: 'Removed', type: 'preset', enabled: true },
        ], oaiPreset: 'Gemini Omega 2.4.2',
    }],
});
ok('valid backup imports', imported.length === 1 && Profiles.exportData().profiles.length === 1);
presetName = 'Gemini Omega 4.2';
const profilePreview = await Profiles.preview(imported[0].id);
ok('preview detects preset mismatch without mutating state', profilePreview.presetMismatch
    && profilePreview.report.prompt.changed === 1 && profilePreview.report.regex.changed === 1
    && !lustOrder.enabled && !lustRegex.disabled);
const appliedProfile = await Profiles.apply(imported[0].id);
ok('apply reports missing prompt and regex', appliedProfile.report.prompt.matched === 1
    && appliedProfile.report.prompt.total === 2
    && appliedProfile.report.regex.matched === 1
    && appliedProfile.report.regex.total === 2);
const afterProfileApply = await Profiles.preview(imported[0].id);
ok('apply captures undo and changes prompt + regex', !!Profiles.undoProfile
    && afterProfileApply.report.prompt.changed === 0 && afterProfileApply.report.regex.changed === 0);
await Profiles.undoLast();
const afterProfileUndo = await Profiles.preview(imported[0].id);
ok('undo restores prompt + regex and clears itself', afterProfileUndo.report.prompt.changed === 1
    && afterProfileUndo.report.regex.changed === 1 && Profiles.undoProfile === null);
let invalidImportThrew = false;
try { Profiles.importData({ profiles: [] }); } catch (_) { invalidImportThrew = true; }
ok('invalid backup is rejected', invalidImportThrew);

console.log('RUNTIME 13) overlapping panel refreshes coalesce');
const realRefreshNow = Panel.refreshNow;
const realPanelRoot = Panel.root;
let refreshRuns = 0;
let releaseRefresh;
Panel.root = {};
Panel.refreshNow = () => {
    refreshRuns += 1;
    if (refreshRuns > 1) return Promise.resolve();
    return new Promise((resolve) => { releaseRefresh = resolve; });
};
const firstRefresh = Panel.refresh();
const overlappingRefresh = Panel.refresh();
ok('overlapping callers share one promise', firstRefresh === overlappingRefresh);
releaseRefresh();
await firstRefresh;
ok('overlap queues only one follow-up refresh', refreshRuns === 2);
Panel.refreshNow = realRefreshNow;
Panel.root = realPanelRoot;

console.log(fail ? `\nFAILED: ${fail}` : `\nselfcheck: all assertions passed`);
process.exit(fail ? 1 : 0);
