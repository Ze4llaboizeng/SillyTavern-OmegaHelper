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
const entryRaw = fs.readFileSync(path.join(DIR, 'index.js'), 'utf8');
const entryModules = ['config.js', 'prompts.js', 'features.js', 'reasoning.js', 'panel.js'];
const moduleFiles = ['config.js', 'prompts.js', 'features.js', 'reasoning.js',
    'guide.js', 'panel-view.js', 'ui.js', 'panel.js'];
const moduleSources = moduleFiles.map((file) => fs.readFileSync(path.join(DIR, 'src', file), 'utf8'));
const raw = [...moduleSources, entryRaw].join('\n');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const omega = JSON.parse(fs.readFileSync(path.join(DIR, 'Gemini Omega 3.0 (14-8-26).json'), 'utf8'));

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
ok('entrypoint only wires domain modules', entryRaw.split(/\r?\n/).length < 300
    && entryModules.every((file) => entryRaw.includes(`./src/${file}`)));
ok('planning template constant', /REASONING_TEMPLATE = \{ prefix: '<planning>', suffix: '<\/planning>' \}/.test(raw));
ok('fix() writes #reasoning_prefix', raw.includes("$('#reasoning_prefix').val(REASONING_TEMPLATE.prefix)"));
ok('fix() writes #reasoning_suffix', raw.includes("$('#reasoning_suffix').val(REASONING_TEMPLATE.suffix)"));
ok('Omega/5EX gate present', raw.includes('SUPPORTED_PRESET'));
ok('watch popup is immediate', /cooldown: 0, \/\/ think broken/.test(raw));
ok('watch reads the native reasoning DOM with saved-object fallback',
    raw.includes('.mes_reasoning`')
    && raw.includes('message?.extra?.reasoning'));
ok('think checker is independent from formatting doctor',
    /async run\(messageId,[\s\S]*watchReasoning[\s\S]*Prompts\.getOaiName\(\)/.test(raw)
    && !raw.slice(raw.indexOf('const Watch ='), raw.indexOf('const Guide =')).includes('Doctor.fix()'));
ok('message hooks pass the exact reply id',
    raw.includes('const onMessage = (messageId)') && raw.includes('Watch.run(messageId)')
    && raw.includes('et.CHARACTER_MESSAGE_RENDERED'));
ok('chat load checks every non-greeting think without invoking formatting doctor',
    /et\.CHAT_CHANGED[\s\S]*Watch\.run\(undefined, \{ showOk: true \}\)/.test(raw)
    && !raw.slice(raw.indexOf('if (et.CHAT_CHANGED)'), raw.indexOf('if (et.CHATCOMPLETION_MODEL_CHANGED)')).includes('Doctor.audit'));
for (const cls of ['oh-row', 'oh-toggle', 'oh-slider', 'oh-badge', 'oh-alert', 'oh-tab']) {
    ok(`index.js emits .${cls}`, raw.includes(cls));
}
ok('alert setting id does not collide with popup host',
    raw.includes('id="oh-alerts-enabled"') && !/<input[^>]+id="oh-alerts"/.test(raw));
ok('search rendering is debounced', /_searchTimer\s*=\s*setTimeout\([\s\S]*?this\.render\(\);[\s\S]*?140\);/.test(raw));
ok('search never persists a stale filter across panel sessions',
    /async show\(\)[\s\S]*this\.search = ''/.test(raw) && !raw.includes('lastSearch'));
ok('generation waits for required Sigil prompts',
    /GENERATION_STARTED[\s\S]*async \(_type, _opts, dryRun\)[\s\S]*await RequiredPrompts\.enforce\(\)/.test(raw));
ok('group changes are batched', /async setGroup[\s\S]*this\.setPacks\(subset, enabled/.test(raw));
ok('current Omega patch notice is bundled',
    raw.includes("id: 'gemini-omega-2.6-2026-08-15'")
    && raw.includes('1537440603019808869'));
ok('patch popup links to the existing beginner guide',
    /label: 'คู่มือมือใหม่'[\s\S]*app\.Panel\?\.show[\s\S]*app\.Guide\?\.start/.test(raw));
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
ok('beginner guide has a visible entry point and focus treatment',
    raw.includes('id="oh-guide"') && css.includes('.oh-guide-focus'));
ok('beginner guide scrolls each explained control into view',
    /const Guide = \{[\s\S]*scrollIntoView\?\.\(\{ behavior: 'smooth'/.test(raw));
ok('beginner guide targets prompt identity and never guesses the first visible row',
    raw.includes('row.dataset.guideName') && raw.includes('section.dataset.guideGroup')
    && raw.includes('this.steps.filter((step) => this.target(step))')
    && raw.includes('if (step.find) return named || null')
    && !/targets\.find\(\(item\) => item\.offsetParent/.test(raw));
ok('beginner guide targets the real L2 prompt row',
    raw.includes("find: 'L2 Balanced (50:50)', group: 'Prose Floor'")
    && !raw.includes('id="oh-beginner-l2"'));
const guideSource = raw.slice(raw.indexOf('const Guide ='), raw.indexOf('const Panel ='));
const guideFinds = [...guideSource.matchAll(/\{ find: '([^']+)'/g)].map((match) => match[1]);
const omegaGuideOrder = new Set((omega.prompt_order.find((list) => list.character_id === 100001)?.order || [])
    .map((entry) => String(entry.identifier)));
const omegaGuideNames = omega.prompts.filter((prompt) => omegaGuideOrder.has(String(prompt.identifier)))
    .map((prompt) => String(prompt.name || '').normalize('NFKC'));
ok('every named guide target exists in current Omega prompt_order',
    guideFinds.every((find) => omegaGuideNames.some((name) => name.includes(find.normalize('NFKC')))),
    guideFinds.filter((find) => !omegaGuideNames.some((name) => name.includes(find.normalize('NFKC')))).join(', '));
ok('guide waits for panel data and temporarily clears search',
    /async start\(root\)[\s\S]*await (?:app\.)?Panel\.refresh\(\)[\s\S]*(?:app\.)?Panel\.search = ''/.test(raw));
ok('beginner guide covers every Omega engine and a safe starter recipe',
    ['Helios (All-rounder)', 'Luna (Storyteller)', 'Aether (World Expansion)',
        'Aphrodite (Romance)', 'Pantheon (Debation)', 'L2 Balanced']
        .every((name) => raw.includes(name))
    && raw.includes('Helios + ภาษาไทย + บุคคลที่สาม Default + Dynamic + L2 Balanced'));
ok('dialog restores focus and traps keyboard focus',
    raw.includes('opener?.isConnected && opener.focus?.()') && raw.includes("e.key === 'Tab' && this.isOpen"));
ok('minimum client version covers preset regex API', manifest.minimum_client_version === '1.13.5');
ok('extension versions stay in sync', manifest.version === '1.6.3'
    && raw.includes("const VERSION = '1.6.3'"));
ok('profile apply previews changes and exposes one-step undo',
    raw.includes('async preview(id)') && raw.includes('async undoLast()')
    && raw.includes('id="oh-profile-undo"') && raw.includes('window.confirm?.(lines.join'));
ok('panel refreshes coalesce and load independent state in parallel',
    raw.includes('_refreshQueued = true')
    && /Promise\.all\(\[\s*Features\.resolve\(\),\s*Engine\.isPresetAllowed\(\),\s*Prompts\.getOaiName\(\)/.test(raw));
ok('UI retry stops when requested controls are ready', /if \(ready \|\| tries >= 40\) clearInterval\(timer\)/.test(raw));
ok('mutation checks are batched to one animation frame',
    /new MutationObserver[\s\S]*if \(uiFrame\) return;[\s\S]*requestAnimationFrame/.test(raw));

console.log('STATIC 5) real ES module wiring');
const modularApp = {};
const [{ createPromptServices }, { createFeatureServices }, { createReasoningServices }, { createPanelServices }] = await Promise.all([
    import('./src/prompts.js'), import('./src/features.js'), import('./src/reasoning.js'), import('./src/panel.js'),
]);
Object.assign(modularApp, createPromptServices());
Object.assign(modularApp, createFeatureServices(modularApp));
Object.assign(modularApp, createReasoningServices(modularApp));
Object.assign(modularApp, createPanelServices(modularApp));
const serviceNames = ['Core', 'Prompts', 'RequiredPrompts', 'Engine', 'Features', 'Profiles',
    'Alerts', 'PatchNotice', 'Doctor', 'Watch', 'Guide', 'Panel', 'UI'];
ok('all domain services compose through the entrypoint contract', serviceNames.every((name) => modularApp[name]));

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
    { identifier: 'feature-aether', name: 'Aether (World Expansion)', content: `<planning>
//-- STAGE 10 [DECISION · freshest, strongest pull]: NPC SIMULATION --//` },
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
globalThis.__CLICKABLE_EXT__ = null;
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
    extensions: dataUrl('export function findExtension(){return globalThis.__CLICKABLE_EXT__}'),
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
const reasoningDom = new Map();
global.document = { body: el(), hidden: false, getElementById: () => null, querySelector: (selector) => {
    const id = String(selector).match(/mesid="(\d+)"/)?.[1];
    return id && reasoningDom.has(Number(id)) ? { textContent: reasoningDom.get(Number(id)) } : null;
},
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

const stripModuleSyntax = (source) => source
    .replace(/^import .*?;\r?\n/gm, '')
    .replace(/^export /gm, '');
const src = [...moduleSources.map(stripModuleSyntax), stripModuleSyntax(entryRaw)].join('\n')
    .replace("'/scripts/openai.js'", `'${stub.openai}'`)
    .replace("'/scripts/extensions/regex/engine.js'", `'${stub.engine}'`)
    .replace("'/scripts/extensions.js'", `'${stub.extensions}'`)
    .replace("'/scripts/power-user.js'", `'${stub.powerUser}'`)
    .replace(/    onReady\(\);\r?\n\}\)\(\);/, '    globalThis.__OH__ = { Doctor, Watch, Core, Alerts, RequiredPrompts, Features, Profiles, PatchNotice, Guide, Panel };\n    onReady();\n})();');
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
const { Doctor, Watch, Core, Alerts, RequiredPrompts, Features, Profiles, PatchNotice, Guide, Panel } = globalThis.__OH__;
Object.assign(Core.getSettings(), { enabled: true, checkFormatting: true, watchReasoning: true, alerts: true });
const issueIds = async () => (await Doctor.check()).issues.map((i) => i.id).sort();

console.log('RUNTIME 0) beginner guide opens before resolving targets');
const guideRoot = el();
await Guide.start(guideRoot);
ok('guide opens', Guide.root === guideRoot && Guide.step === 0);
Guide.move(1);
ok('guide advances', Guide.step === 1);
Guide.close();
ok('guide closes', Guide.root === null);

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

console.log('RUNTIME 6) native reasoning blocks are checked, greeting is skipped');
model = 'gemini-3.5-flash';
await Doctor.fix();
ctx.chat = [{ is_user: false, is_system: false, extra: { reasoning: '' } }];
ok('greeting #0 is skipped', (await Watch.run(0)) === null && !Alerts.shown.has('watch'));
ctx.chat.push(
    { is_user: true, is_system: false, mes: 'hello' },
    { is_user: false, is_system: false, mes: 'visible reply', extra: { reasoning: 'STAGE 1 only' } },
);
ok('missing strongest stage reports', (await Watch.run(2))?.some((p) => p.id === 'strongestStageMissing'));
ok('same reasoning block checked again also reports', (await Watch.run(2))?.some((p) => p.id === 'strongestStageMissing'));
ok('alert registered', Alerts.shown.has('watch'));
ctx.chat[2].extra.reasoning = 'STAGE 10 NPC SIMULATION';
ok('clean reply clears', (await Watch.run(2)).length === 0);
reasoningDom.set(2, 'STAGE 1 rendered in the native block');
ctx.chat[2].extra.reasoning = 'STAGE 10 saved but stale';
Core.getSettings().checkFormatting = false;
ok('native .mes_reasoning content is preferred over stale saved data',
    (await Watch.run(2))?.some((p) => p.id === 'strongestStageMissing'));
reasoningDom.delete(2);
Core.getSettings().checkFormatting = true;
ctx.chat.push(
    { is_user: true, is_system: false, mes: 'again' },
    { is_user: false, is_system: false, mes: 'reply 2', extra: { reasoning: 'STAGE 1 only' } },
);
ok('chat-load scan checks all replies and identifies the broken message',
    (await Watch.run())?.some((p) => p.messageId === 4 && p.id === 'strongestStageMissing'));
ctx.chat[4].extra.reasoning = 'S10 complete';
ok('chat-load success path can report completion',
    (await Watch.run(undefined, { showOk: true })).length === 0 && Alerts.shown.has('watch-ok'));
ctx.chat = [ctx.chat[0]];
ok('new chat containing only greeting has nothing to inspect', (await Watch.run()) === null);

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
const omegaOrder = omega.prompt_order.find((list) => list.character_id === 100001)?.order || [];
const omegaPromptById = new Map(omega.prompts.map((prompt) => [String(prompt.identifier), prompt]));
const omegaEnabledById = new Map(omegaOrder.map((entry) => [String(entry.identifier), !!entry.enabled]));
const omegaSectioned = Features.assignPresetSections(omegaOrder.map((entry, orderIndex) => ({
    ...omegaPromptById.get(String(entry.identifier)),
    enabled: omegaEnabledById.get(String(entry.identifier)), inOrder: true, orderIndex,
})).filter((prompt) => prompt.identifier));
const omegaLength = omegaSectioned.filter((prompt) => prompt.section?.title === 'Length'
    && !prompt.marker && !prompt.sectionHeader && !prompt.sectionDivider);
ok('current Omega Length renders all seven options',
    omegaLength.length === 7
    && ['Chat Mode', 'Chatty', 'Short', 'Medium', 'Long', 'Extended', 'Dynamic']
        .every((name) => omegaLength.some((prompt) => prompt.name.includes(name))));
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

console.log('RUNTIME 8b) clickable choices require their extension');
const omegaClickable = omega.prompts.find((prompt) => /Next Scenario Suggestion/.test(prompt.name || ''));
const omegaReadmePrompt = omega.prompts.find((prompt) => /อ่านก่อนใช้งาน/.test(prompt.name || ''));
ok('detects the real Omega clickable option but not its read-me prompt',
    Features.needsClickableInputs([{ prompts: [omegaClickable] }])
    && !Features.needsClickableInputs([{ prompts: [omegaReadmePrompt] }]));
const clickablePack = {
    def: { title: 'Next Scenario Suggestion' },
    prompts: [{ identifier: 'clickable-choice', enabled: false,
        content: 'Use st-clickable-inputs and emit <button>Choice</button>' }],
    state: 'off', promptOn: 0, controlledOn: 0, controlledTotal: 1,
};
let dependencyError = null;
try { await Features.setPack(clickablePack, true, { reload: false, quiet: true }); }
catch (error) { dependencyError = error; }
ok('missing extension blocks enable and preserves OFF state',
    dependencyError?.code === 'OH_EXTENSION_REQUIRED'
    && !clickablePack.prompts[0].enabled && clickablePack.state === 'off');
globalThis.__CLICKABLE_EXT__ = { name: 'third-party/st-clickable-inputs', enabled: false };
dependencyError = null;
try { await Features.setPack(clickablePack, true, { reload: false, quiet: true }); }
catch (error) { dependencyError = error; }
ok('installed but disabled extension is still blocked', dependencyError?.code === 'OH_EXTENSION_REQUIRED');
globalThis.__CLICKABLE_EXT__ = { name: 'third-party/st-clickable-inputs', enabled: true };
await Features.setPack(clickablePack, true, { reload: false, quiet: true });
ok('installed and enabled extension allows the prompt',
    clickablePack.prompts[0].enabled && clickablePack.state === 'on');

console.log('RUNTIME 9) planning priority follows the enabled preset engine');
const priorityStages = Watch.priorityStages([
    { enabled: true, name: 'Aether', content: `<planning>
//-- STAGE 1 [ANCHOR · strong-attn]: ENTITY LOCK --//
//-- STAGE 5 [AMBIENT · gated, weak-attn tolerant]: PULSE --//
//-- STAGE 10 [DECISION · freshest, strongest pull]: NPC SIMULATION --//` },
    { enabled: false, name: 'Luna', content: '<planning>\n//-- STAGE 9 [DECISION · strongest pull]: POLISH --//' },
]);
ok('priority metadata parsed from enabled engine',
    priorityStages.map((s) => `${s.priority}:${s.number}`).join(',') === 'strong:1,weak:5,strongest:10');
ok('missing parsed planning is flagged', Watch.inspectPlanning('', priorityStages)[0]?.id === 'planningMissing');
ok('missing strongest stage is flagged', Watch.inspectPlanning('STAGE 1 done', priorityStages)[0]?.id === 'strongestStageMissing');
ok('strongest stage present passes', Watch.inspectPlanning('S1 anchor\nS10 decision', priorityStages).length === 0);
const currentOmegaStages = Watch.priorityStages(omega.prompts.map((prompt) => ({
    ...prompt,
    enabled: /Aether|Luna|Helios|Aphrodite|Pantheon/.test(prompt.name || ''),
})));
ok('current Omega 3.0 priority map stays readable',
    currentOmegaStages.filter((s) => s.priority === 'strongest').map((s) => s.number).join(',') === '10,10,8,4,4');

console.log('RUNTIME 10) preset version parsing and comparison');
ok('parses Omega name before its date',
    JSON.stringify(PatchNotice.parseVersion('Gemini Omega 2.6 (15-8-26)')) === '[2,6,0]');
ok('parses two-part JB version', JSON.stringify(PatchNotice.parseVersion('Custom JB v3.1')) === '[3,1,0]');
ok('newer version compares above latest', PatchNotice.compare([3, 0, 0], [2, 4, 2]) > 0);
ok('same version compares equal', PatchNotice.compare([2, 4, 2], [2, 4, 2]) === 0);
ok('older version compares below latest', PatchNotice.compare([2, 4, 1], [2, 4, 2]) < 0);

console.log('RUNTIME 11) healthy patch state stays quiet');
let patchPopups = 0;
const realPatchShow = PatchNotice.show;
PatchNotice.show = () => { patchPopups += 1; return {}; };
presetName = 'Gemini Omega 2.6';
const healthyPatch = await PatchNotice.check();
ok('latest preset does not open a popup', patchPopups === 0 && healthyPatch.relation === 0);
presetName = 'Gemini Omega 2.5';
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
