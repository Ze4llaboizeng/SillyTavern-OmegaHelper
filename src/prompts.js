import { DEFAULTS, LOG, MODULE_NAME, REQUIRED_PROMPT_PATTERNS, SUPPORTED_PRESET } from './config.js';

export function createPromptServices() {
    const Core = {
        getContext() {
            try { return window.SillyTavern?.getContext?.() || null; } catch (_) { return null; }
        },
        getSettings() {
            const ctx = this.getContext();
            if (!ctx) return { ...DEFAULTS, profiles: [], collapsedGroups: {} };
            const store = ctx.extensionSettings || (ctx.extensionSettings = {});
            if (!store[MODULE_NAME] || typeof store[MODULE_NAME] !== 'object') store[MODULE_NAME] = {};
            for (const [k, v] of Object.entries(DEFAULTS)) {
                if (!(k in store[MODULE_NAME])) {
                    store[MODULE_NAME][k] = Array.isArray(v) ? [] : (v && typeof v === 'object' ? { ...v } : v);
                }
            }
            if (!Array.isArray(store[MODULE_NAME].profiles)) store[MODULE_NAME].profiles = [];
            if (!store[MODULE_NAME].collapsedGroups || typeof store[MODULE_NAME].collapsedGroups !== 'object') {
                store[MODULE_NAME].collapsedGroups = {};
            }
            return store[MODULE_NAME];
        },
        saveSettings() {
            try { this.getContext()?.saveSettingsDebounced?.(); } catch (_) {}
        },
        toast(type, msg) {
            try { toastr?.[type]?.(msg, 'Omega Helper'); }
            catch (_) { console.log(LOG, type, msg); }
        },
        uid() {
            try { return crypto.randomUUID(); } catch (_) {
                return 'oh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            }
        },
        escape(s) {
            return String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },
    };

    // -----------------------------------------------------------------------
    // Chat Completion Prompt Manager (core openai.js only)
    // -----------------------------------------------------------------------
    const Prompts = {
        mod: null,
        manager: null,
        saveQueue: Promise.resolve(),
        async load() {
            if (this.mod) return this.mod;
            this.mod = await import('/scripts/openai.js');
            return this.mod;
        },
        async getManager() {
            if (this.manager) return this.manager;
            const mod = await this.load();
            this.manager = mod?.promptManager || null;
            return this.manager;
        },
        queueSave(pm, render = false) {
            this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
                try {
                    if (typeof pm.saveServiceSettings === 'function') await pm.saveServiceSettings();
                    else Core.saveSettings();
                } catch (_) { Core.saveSettings(); }
                if (render) {
                    try { await pm.render?.(false); } catch (_) {}
                }
            });
            return this.saveQueue;
        },
        syncNativeEnabled(pm, identifiers, enabled) {
            const ids = new Set((identifiers || []).map(String));
            if (!ids.size) return;
            const prefix = pm?.configuration?.prefix || 'completion_';
            const disabledClass = `${prefix}prompt_manager_prompt_disabled`;
            const container = pm?.containerElement
                || document.getElementById(pm?.configuration?.containerIdentifier)
                || document;

            // Patch only the affected native rows. A full Prompt Manager render
            // recalculates the whole list and is noticeably slow on phones.
            container.querySelectorAll?.('[data-pm-identifier]')?.forEach((row) => {
                if (!ids.has(String(row?.dataset?.pmIdentifier))) return;
                row.classList.toggle(disabledClass, !enabled);
                const toggle = row.querySelector?.('.prompt-manager-toggle-action');
                toggle?.classList.toggle('fa-toggle-on', !!enabled);
                toggle?.classList.toggle('fa-toggle-off', !enabled);
            });

            try {
                const counts = pm?.tokenHandler?.getCounts?.();
                if (counts) for (const id of ids) counts[id] = null;
            } catch (_) {}
        },
        async getOaiName() {
            try {
                const mod = await this.load();
                return mod?.oai_settings?.preset_settings_openai
                    || mod?.oai_settings?.preset_settings
                    || null;
            } catch (_) { return null; }
        },
        async listLive() {
            const pm = await this.getManager();
            if (!pm) return { prompts: [], order: [], pm: null };

            const rawPrompts = (pm.serviceSettings?.prompts || []).map((p) => ({
                identifier: p?.identifier,
                name: p?.name || p?.identifier || '',
                content: p?.content || '',
                role: p?.role || 'system',
                marker: !!p?.marker,
                systemPrompt: !!p?.system_prompt,
                editable: !p?.marker && !p?.system_prompt,
            })).filter((p) => p.identifier);

            let order = [];
            try {
                const dummyId = pm.configuration?.promptOrder?.dummyId ?? 100001;
                const char = pm.activeCharacter || { id: dummyId };
                order = pm.getPromptOrderForCharacter?.(char) || [];
            } catch (_) {}
            if (!order.length) {
                const lists = pm.serviceSettings?.prompt_order || [];
                const dummyId = pm.configuration?.promptOrder?.dummyId ?? 100001;
                const hit = lists.find((x) => String(x.character_id) === String(dummyId)) || lists[0];
                order = hit?.order || [];
            }
            const enabledMap = new Map((order || []).map((e) => [String(e.identifier), !!e.enabled]));
            const promptMap = new Map(rawPrompts.map((p) => [String(p.identifier), p]));
            const orderedPrompts = [];
            const seen = new Set();
            for (let orderIndex = 0; orderIndex < (order || []).length; orderIndex += 1) {
                const entry = order[orderIndex];
                const id = String(entry?.identifier ?? '');
                const prompt = promptMap.get(id);
                if (!prompt || seen.has(id)) continue;
                seen.add(id);
                orderedPrompts.push({ ...prompt, orderIndex });
            }
            for (const prompt of rawPrompts) {
                const id = String(prompt.identifier);
                if (seen.has(id)) continue;
                orderedPrompts.push({ ...prompt, orderIndex: Number.MAX_SAFE_INTEGER });
            }
            return {
                prompts: orderedPrompts.map((p) => ({
                    ...p,
                    enabled: enabledMap.has(String(p.identifier)) ? enabledMap.get(String(p.identifier)) : false,
                    inOrder: enabledMap.has(String(p.identifier)),
                })),
                order,
                pm,
            };
        },
        async setEnabled(identifiers, enabled, { render = true } = {}) {
            const ids = [...new Set((identifiers || []).map(String).filter(Boolean))];
            if (!ids.length) return 0;
            const pm = await this.getManager();
            if (!pm?.serviceSettings) throw new Error('Chat Completion / Prompt Manager ยังไม่พร้อม');

            const dummyId = pm.configuration?.promptOrder?.dummyId ?? 100001;
            const char = pm.activeCharacter || { id: dummyId };
            const lists = pm.serviceSettings.prompt_order || (pm.serviceSettings.prompt_order = []);
            let list = lists.find((x) => String(x.character_id) === String(char.id));
            if (!list) {
                // also try dummy global list
                list = lists.find((x) => String(x.character_id) === String(dummyId));
            }
            if (!list) {
                list = { character_id: char.id ?? dummyId, order: [] };
                lists.push(list);
            }
            if (!Array.isArray(list.order)) list.order = [];

            const want = new Set(ids);
            let changed = 0;
            const seen = new Set();
            for (const e of list.order) {
                if (!e || e.identifier == null) continue;
                const id = String(e.identifier);
                if (!want.has(id)) continue;
                seen.add(id);
                if (!!e.enabled !== !!enabled) {
                    e.enabled = !!enabled;
                    changed += 1;
                }
            }
            // Append missing identifiers (enable path) so toggles work even if not yet in order
            for (const id of ids) {
                if (seen.has(id)) continue;
                list.order.push({ identifier: id, enabled: !!enabled });
                changed += 1;
            }

            // Avoid disk writes and a full Prompt Manager render on the common
            // every-turn path where all required prompts are already enabled.
            if (changed > 0) {
                this.syncNativeEnabled(pm, ids, enabled);
                // The live prompt_order above is authoritative immediately.
                // Persistence runs serially in the background so rapid taps never wait.
                void this.queueSave(pm, render);
            }
            return changed;
        },
        async update(identifier, { name, content, role = 'system' } = {}) {
            const cleanName = String(name || '').trim();
            const cleanContent = String(content || '').trim();
            if (!cleanName) throw new Error('ใส่ชื่อ Prompt ก่อน');
            if (!cleanContent) throw new Error('ใส่เนื้อหา Prompt ก่อน');

            const pm = await this.getManager();
            if (!pm?.serviceSettings) throw new Error('Chat Completion / Prompt Manager ยังไม่พร้อม');
            const prompt = (pm.serviceSettings.prompts || [])
                .find((item) => String(item?.identifier) === String(identifier));
            if (!prompt) throw new Error('ไม่พบ Prompt ที่ต้องการแก้ไข');
            if (prompt.marker || prompt.system_prompt) throw new Error('Prompt ระบบไม่อนุญาตให้แก้จากหน้านี้');

            prompt.name = cleanName;
            prompt.content = cleanContent;
            prompt.role = ['system', 'user', 'assistant'].includes(role) ? role : 'system';

            try {
                if (typeof pm.saveServiceSettings === 'function') await pm.saveServiceSettings();
                else Core.saveSettings();
            } catch (_) { Core.saveSettings(); }
            try { await pm.render?.(false); } catch (_) {}
            return { identifier: prompt.identifier, name: cleanName };
        },
    };

    const RequiredPrompts = {
        matches(name) {
            const value = String(name || '').trim().replace(/\s+/g, ' ');
            return REQUIRED_PROMPT_PATTERNS.some((pattern) => pattern.test(value));
        },

        inspect(prompts) {
            const required = (prompts || []).filter((prompt) => !prompt.marker && this.matches(prompt.name));
            return {
                required,
                total: required.length,
                on: required.filter((prompt) => prompt.enabled).length,
                off: required.filter((prompt) => !prompt.enabled),
            };
        },

        async enforce() {
            const settings = Core.getSettings();
            if (!settings.enabled) return { skipped: true, changed: 0, total: 0 };

            const preset = await Prompts.getOaiName();
            if (!SUPPORTED_PRESET.test(String(preset || ''))) {
                return { skipped: true, changed: 0, total: 0, preset };
            }

            const { prompts } = await Prompts.listLive();
            const state = this.inspect(prompts);
            const changed = state.off.length
                ? await Prompts.setEnabled(state.off.map((prompt) => prompt.identifier), true, { render: false })
                : 0;
            return { ...state, changed, preset };
        },
    };

    // -----------------------------------------------------------------------
    // Regex engine (core only)
    // -----------------------------------------------------------------------

    return { Core, Prompts, RequiredPrompts };
}

