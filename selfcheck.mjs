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

// ============================== RUNTIME ==============================
const noop = () => {};
const dataUrl = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');

const power_user = {
    user_prompt_bias: '<planning>', show_user_prompt_bias: true,
    reasoning: { prefix: '<planning>', suffix: '</planning>', auto_parse: true, separator: '' },
};
let model = 'gemini-3.5-flash';
let presetName = 'Gemini Omega 4.2';
globalThis.__PU__ = power_user;
Object.defineProperty(globalThis, '__MODEL__', { get: () => model });
Object.defineProperty(globalThis, '__PRESET__', { get: () => presetName });

const stub = {
    openai: dataUrl(`
export const oai_settings = { get preset_settings_openai(){ return globalThis.__PRESET__; } };
export function getChatCompletionModel(){ return globalThis.__MODEL__; }
export const promptManager = { configuration:{promptOrder:{dummyId:100001}}, activeCharacter:{id:100001},
  serviceSettings:{prompts:[],prompt_order:[{character_id:100001,order:[]}]}, saveServiceSettings(){}, render(){} };`),
    engine: dataUrl(`
export const SCRIPT_TYPES = { PRESET:'preset', GLOBAL:'global', SCOPED:'scoped' };
export function getScriptsByType(){return[]} export function saveScriptsByType(){}
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
    .replace('    onReady();\n})();', '    globalThis.__OH__ = { Doctor, Watch, Core, Alerts };\n    onReady();\n})();');
if (src === raw) { console.error('boot rewrite matched nothing — assertions would be vacuous'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-selfcheck-'));
const boot = path.join(tmp, 'boot.mjs');
fs.writeFileSync(boot, src);
try {
    await import(pathToFileURL(boot).href);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
const { Doctor, Watch, Core, Alerts } = globalThis.__OH__;
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

console.log('RUNTIME 7) inspect() false-positive guards');
const T = { prefix: '<planning>', suffix: '</planning>' };
const ins = (t) => Watch.inspect(t, T).map((p) => p.id);
ok('html/markdown clean', ins('Reply <b>b</b> <i>i</i> <div><span>x</span></div>').length === 0, JSON.stringify(ins('<b>b</b>')));
ok('self-closing clean', ins('a<br/>b <img src="x"/>').length === 0);
ok('balanced omega tag clean', ins('<LustScore>72</LustScore>').length === 0);
ok('unpaired omega tag flagged', ins('<LustScore>72 text').includes('blockUnclosed'));
ok('leftover parsed block flagged', ins('<planning>x</planning> hi').includes('thinkNotParsed'));

console.log(fail ? `\nFAILED: ${fail}` : `\nselfcheck: all assertions passed`);
process.exit(fail ? 1 : 0);
