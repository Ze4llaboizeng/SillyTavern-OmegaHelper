/* Omega Helper v1.6.3 — small entrypoint; domain code lives in src/ */
import { EXT_ID, LOG, VERSION } from './src/config.js';
import { createPromptServices } from './src/prompts.js';
import { createFeatureServices } from './src/features.js';
import { createReasoningServices } from './src/reasoning.js';
import { createPanelServices } from './src/panel.js';

(() => {
    if (typeof window === 'undefined') { global.window = {}; }
    if (window.__OMEGA_HELPER_LOADED__) return;
    window.__OMEGA_HELPER_LOADED__ = true;

    const app = {};
    Object.assign(app, createPromptServices());
    Object.assign(app, createFeatureServices(app));
    Object.assign(app, createReasoningServices(app));
    Object.assign(app, createPanelServices(app));

    const {
        Core, RequiredPrompts, Features, Profiles, Alerts, PatchNotice, Doctor, Watch, Guide, Panel, UI,
    } = app;

    function registerSlash() {
        try {
            const ctx = Core.getContext();
            if (!ctx?.SlashCommandParser?.addCommandObject || !ctx.SlashCommand?.fromProps) return;
            const add = (props) => {
                const cmd = ctx.SlashCommand.fromProps(props);
                if (cmd) ctx.SlashCommandParser.addCommandObject(cmd);
            };
            add({
                name: 'omega',
                callback: async () => { await Panel.show(); return ''; },
                helpString: 'Open Omega Helper (Chat Completion features + regex).',
            });
            add({
                name: 'oh-feat',
                callback: async (args, value) => {
                    const raw = `${value || ''} ${args?.state || ''}`.trim().split(/\s+/).filter(Boolean);
                    let name = raw[0] || '';
                    let state = (raw[1] || 'toggle').toLowerCase();
                    if (['on', 'off', 'true', 'false', '1', '0'].includes(name.toLowerCase()) && raw[1]) {
                        state = name.toLowerCase();
                        name = raw.slice(1).join(' ');
                    } else {
                        name = raw.slice(0, -1).join(' ') || raw[0] || '';
                        if (raw.length >= 2) state = raw[raw.length - 1].toLowerCase();
                    }
                    let enabled;
                    if (['off', 'false', '0', 'disable'].includes(state)) enabled = false;
                    else if (['on', 'true', '1', 'enable'].includes(state)) enabled = true;
                    else {
                        // toggle: resolve current
                        const title = await Features.setByName(name || value, true);
                        return `on:${title}`;
                    }
                    // fix name if we consumed state as last token
                    if (['on', 'off', 'true', 'false', '0', '1', 'enable', 'disable'].includes(state)) {
                        const parts = String(value || '').trim().split(/\s+/);
                        if (parts.length >= 2 && ['on', 'off', 'true', 'false', '0', '1'].includes(parts[parts.length - 1].toLowerCase())) {
                            name = parts.slice(0, -1).join(' ');
                        } else {
                            name = String(value || name).replace(/\s+(on|off|true|false|0|1)$/i, '').trim() || name;
                        }
                    }
                    const title = await Features.setByName(name, enabled);
                    return `${enabled ? 'on' : 'off'}:${title}`;
                },
                helpString: 'Toggle a preset prompt by its real name. /oh-feat Lust Score off',
            });
            add({
                name: 'oh-check',
                callback: async () => {
                    const res = await Doctor.check();
                    await Doctor.audit({ quiet: false, cooldown: 0 });
                    return res.issues.length ? `issues:${res.issues.length}` : 'ok';
                },
                helpString: 'เช็ค Reasoning Formatting กับโมเดลปัจจุบัน',
            });
            add({
                name: 'oh-fix',
                callback: async () => {
                    const rule = await Doctor.fix();
                    return `fixed:${rule.id}`;
                },
                helpString: 'ปรับ Start Reply With / prefix in chat ให้ตรงโมเดล',
            });
            add({
                name: 'oh-on',
                callback: async (_, name) => {
                    const n = await Features.setByName(String(name || ''), true);
                    return `on:${n}`;
                },
                helpString: 'Enable feature pack. /oh-on Lust',
            });
            add({
                name: 'oh-off',
                callback: async (_, name) => {
                    const n = await Features.setByName(String(name || ''), false);
                    return `off:${n}`;
                },
                helpString: 'Disable feature pack. /oh-off Lust',
            });
        } catch (err) {
            console.debug(LOG, 'slash skip', err);
        }
    }

    /** Debounced, visibility-aware hooks. No polling — event driven only. */
    function registerWatchers() {
        const ctx = Core.getContext();
        const es = ctx?.eventSource;
        const et = ctx?.event_types || ctx?.eventTypes;
        if (!es?.on || !et) return;

        // one timer per concern so a message event can't cancel a model-change audit
        const timers = new Map();
        const later = (key, ms, fn) => {
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => {
                timers.delete(key);
                if (document.hidden) return; // no work while tab is hidden
                fn();
            }, ms));
        };

        // no debounce: user wants the popup the moment a think comes back wrong
        const onMessage = (messageId) => later('watch', 0, () => Watch.run(messageId));
        if (et.MESSAGE_RECEIVED) es.on(et.MESSAGE_RECEIVED, onMessage);
        if (et.CHARACTER_MESSAGE_RENDERED) es.on(et.CHARACTER_MESSAGE_RENDERED, onMessage);
        if (et.MESSAGE_SWIPED) es.on(et.MESSAGE_SWIPED, onMessage);
        if (et.CHAT_CHANGED) {
            es.on(et.CHAT_CHANGED, () => {
                Alerts.clear('watch');
                Alerts.clear('watch-ok');
                // No message id: inspect every native reasoning block, deliberately skipping greeting #0.
                later('chat-watch', 100, () => Watch.run(undefined, { showOk: true }));
            });
        }
        if (et.CHATCOMPLETION_MODEL_CHANGED) {
            es.on(et.CHATCOMPLETION_MODEL_CHANGED, () => later('doctor', 500, () => {
                Alerts.clear('doctor');
                Doctor.audit({ quiet: true, cooldown: 0 });
                Panel.refreshDoctorLine();
            }));
        }
        if (et.OAI_PRESET_CHANGED_AFTER) {
            es.on(et.OAI_PRESET_CHANGED_AFTER, async () => {
                await PatchNotice.check();
                if (Panel.isOpen) await Panel.refresh();
            });
        }
        if (et.GENERATION_STARTED) {
            es.on(et.GENERATION_STARTED, async (_type, _opts, dryRun) => {
                if (dryRun) return;
                try {
                    const result = await RequiredPrompts.enforce();
                    if (result.changed > 0) {
                        console.info(LOG, `เปิด Sigil core ก่อน generate: ${result.changed}/${result.total}`);
                        if (Panel.isOpen) await Panel.refresh();
                    }
                } catch (err) {
                    console.warn(LOG, 'เปิด Sigil core ไม่สำเร็จ', err);
                    Alerts.show({
                        key: 'required-prompts', level: 'warn', ttl: 0, cooldown: 30000,
                        title: 'เปิด Sigil core ก่อน generate ไม่สำเร็จ',
                        body: err?.message || String(err),
                    });
                }
                later('doctor', 0, () => Doctor.audit({ quiet: true }));
            });
        }
        // first audit after settings are live
        later('doctor', 4000, () => Doctor.audit({ quiet: true }));
    }

    function boot() {
        if (boot.done || !window.SillyTavern?.getContext) return;
        boot.done = true;
        UI.injectSettings();
        UI.injectQuickButton();
        UI.injectWandButton();
        registerSlash();
        registerWatchers();
        PatchNotice.check();

        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            UI.injectSettings();
            UI.injectQuickButton();
            UI.injectWandButton();
            const s = Core.getSettings();
            const ready = document.getElementById(`${EXT_ID}-settings`)
                && (!s.enabled || !s.showQuickButton || document.getElementById('oh-quick-btn-wrapper'))
                && (!s.enabled || !s.showWandButton || document.getElementById('oh-wand-btn'));
            if (ready || tries >= 40) clearInterval(timer);
        }, 500);

        const observeTarget = document.getElementById('send_form')?.parentElement || document.body;
        try {
            let uiFrame = 0;
            const mo = new MutationObserver(() => {
                if (uiFrame) return;
                uiFrame = requestAnimationFrame(() => {
                    uiFrame = 0;
                    const s = Core.getSettings();
                    if (s.enabled && s.showQuickButton && !document.getElementById('oh-quick-btn-wrapper')) UI.injectQuickButton();
                    if (s.enabled && s.showWandButton && !document.getElementById('oh-wand-btn')) UI.injectWandButton();
                });
            });
            mo.observe(observeTarget, { childList: true, subtree: true });
        } catch (_) {}

        console.log(LOG, `loaded v${VERSION} — preset Prompt order + separate Regex controls`);
    }

    function onReady() {
        if (window.SillyTavern?.getContext) boot();
        else {
            document.addEventListener('DOMContentLoaded', boot);
            window.addEventListener('load', boot);
            let n = 0;
            const t = setInterval(() => {
                n += 1;
                if (window.SillyTavern?.getContext) {
                    clearInterval(t);
                    boot();
                } else if (n > 60) clearInterval(t);
            }, 250);
        }
    }

    onReady();
})();
