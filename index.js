/* Omega Helper v1.2.2 — preset-ordered Prompt manager + separate Regex controls */
(() => {
    if (typeof window === 'undefined') { global.window = {}; }
    if (window.__OMEGA_HELPER_LOADED__) return;
    window.__OMEGA_HELPER_LOADED__ = true;

    const MODULE_NAME = 'omegaHelper';
    const EXT_ID = 'omega-helper';
    const LOG = '[OmegaHelper]';
    const VERSION = '1.2.2';

    /** Update this block together with the extension whenever Omega ships a JB patch. */
    const PATCH_NOTICE = {
        id: 'gemini-omega-2.4.2-2026-06-07',
        title: 'Gemini Omega 2.4.2',
        version: '2.4.2',
        fileName: 'Gemini Omega 2.4.2 (7-6-26).json',
        sourceUrl: 'https://discord.com/channels/1325303011702079560/1455967291790331978/1512886868872659146',
    };

    const DEFAULTS = {
        enabled: true,
        showQuickButton: true,
        showWandButton: true,
        closeOnEscape: true,
        reloadChatAfterToggle: true,
        collapsedGroups: {},
        profiles: [],
        lastProfileId: null,
        lastSearch: '',
        activeTab: 'features', // features | regex
        alerts: true,            // popup notifications
        watchReasoning: true,    // detect truncated think / missing regex
        checkFormatting: true,   // check Reasoning Formatting vs model
        autoFixFormatting: false,
    };

    /** The reasoning template Omega/5EX presets expect. Both fields, both model rules. */
    const REASONING_TEMPLATE = { prefix: '<planning>', suffix: '</planning>' };

    /** Only these preset families use the planning block. Anything else: stay out. */
    const SUPPORTED_PRESET = /omega|5\s*ex|5ex/i;

    /** Omega infrastructure prompts that must be enabled before every real generation. */
    const REQUIRED_PROMPT_PATTERNS = [
        /^sigil\s+(?:fence|clock|stage|facts)\s+cut\s*\(display\)$/i,
        /^sigil\s+normalize\s+(?:clk|stg|fact)\s*\(prompt\)$/i,
        /^sigil\s+trim\s+(?:clk|stg|fact)\s*\(prompt\)$/i,
        /^sigil\s+auto[-\s]fence\s+wrap\s*\(prompt\)$/i,
        /^sigil\s+(?:fence|clock|stage|facts)\s+cut[-\s]off\s*\(prompt\)$/i,
    ];

    /**
     * Reasoning Formatting rules per model family.
     * prefill  = Start Reply With must hold the reasoning prefix + show prefix in chat ON
     *            (gemini 3.5 flash / 3.1 pro and older)
     * noPrefill = Start Reply With empty + show prefix in chat OFF
     *            (gemini 3.5 flash-lite, 3.6 flash and newer)
     */
    const MODEL_RULES = {
        prefill: {
            id: 'prefill',
            label: 'Prefill (3.5 flash / 3.1 pro ลงมา)',
            startReplyWith: 'prefix',
            showPrefix: true,
        },
        noPrefill: {
            id: 'noPrefill',
            label: 'No prefill (3.5 flash-lite / 3.6 flash ขึ้นไป)',
            startReplyWith: '',
            showPrefix: false,
        },
    };

    /** HTML/markdown tags that are never Omega UI blocks — skip in leak scan */
    const HTML_TAGS = new Set([
        'a', 'b', 'br', 'i', 'p', 'em', 'hr', 'li', 'ol', 'ul', 'td', 'th', 'tr', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'div', 'img', 'pre', 'sub', 'sup', 'code', 'font', 'span', 'small', 'table',
        'tbody', 'thead', 'tfoot', 'strong', 'details', 'summary', 'style', 'script', 'blockquote',
        'button', 'input', 'label', 'select', 'option', 'section', 'header', 'footer', 'figure', 'svg',
        'path', 'video', 'audio', 'iframe', 'canvas', 'center', 'mark', 'del', 'ins', 'u', 's',
    ]);

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
    const Engine = {
        mod: null,
        loading: null,
        saveQueue: Promise.resolve(),
        async load() {
            if (this.mod) return this.mod;
            if (this.loading) return this.loading;
            this.loading = (async () => {
                try {
                    this.mod = await import('/scripts/extensions/regex/engine.js');
                    return this.mod;
                } catch (err) {
                    this.mod = null;
                    throw err;
                } finally {
                    this.loading = null;
                }
            })();
            return this.loading;
        },
        async getScriptsByType(type) {
            const m = await this.load();
            return m.getScriptsByType(type) || [];
        },
        async listAll() {
            const m = await this.load();
            const out = [];
            for (const [key, type] of Object.entries(m.SCRIPT_TYPES)) {
                for (const s of (m.getScriptsByType(type) || [])) {
                    if (!s) continue;
                    out.push({ script: s, type, typeName: key.toLowerCase() });
                }
            }
            return out;
        },
        async saveScripts(scripts, type) {
            const m = await this.load();
            await m.saveScriptsByType(scripts, type);
            try {
                if (type === m.SCRIPT_TYPES.PRESET) {
                    const api = m.getCurrentPresetAPI?.();
                    const name = m.getCurrentPresetName?.();
                    if (api && name) m.allowPresetScripts?.(api, name);
                }
            } catch (_) {}
        },
        queueSave(type) {
            this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
                const m = await this.load();
                await this.saveScripts(m.getScriptsByType(type) || [], type);
            });
            return this.saveQueue;
        },
        async isPresetAllowed() {
            try {
                const m = await this.load();
                const api = m.getCurrentPresetAPI?.();
                const name = m.getCurrentPresetName?.();
                if (!api || !name) return { allowed: false, api, name, reason: 'no-preset' };
                return { allowed: !!m.isPresetScriptsAllowed?.(api, name), api, name, reason: null };
            } catch (err) {
                return { allowed: false, api: null, name: null, reason: String(err?.message || err) };
            }
        },
        async allowPreset() {
            const m = await this.load();
            const api = m.getCurrentPresetAPI?.();
            const name = m.getCurrentPresetName?.();
            if (!api || !name) throw new Error('ยังไม่มี OAI preset ที่ใช้งาน');
            m.allowPresetScripts(api, name);
            try { Core.getContext()?.saveSettingsDebounced?.(); } catch (_) {}
            return { api, name };
        },
        async setEnabled(ids, enabled) {
            const want = new Set((ids || []).filter(Boolean));
            if (!want.size) return 0;
            const all = this.mod
                ? Object.entries(this.mod.SCRIPT_TYPES).flatMap(([key, type]) =>
                    (this.mod.getScriptsByType(type) || []).filter(Boolean)
                        .map((script) => ({ script, type, typeName: key.toLowerCase() })))
                : await this.listAll();
            const byType = new Map();
            let changed = 0;
            for (const e of all) {
                if (!want.has(e.script.id)) continue;
                const wantDisabled = !enabled;
                if (!!e.script.disabled === wantDisabled) continue;
                e.script.disabled = wantDisabled;
                byType.set(e.type, true);
                changed += 1;
            }
            for (const type of byType.keys()) {
                // Regex objects are already live; only persistence is deferred.
                void this.queueSave(type);
            }
            return changed;
        },
        async reloadChatIfNeeded(force = false) {
            const st = Core.getSettings();
            if (!force && !st.reloadChatAfterToggle) return;
            try {
                const ctx = Core.getContext();
                if (typeof ctx?.reloadCurrentChat === 'function') {
                    await ctx.reloadCurrentChat();
                    return;
                }
            } catch (_) {}
            try {
                const mod = await import('/script.js');
                if (typeof mod.reloadCurrentChat === 'function' && typeof mod.getCurrentChatId === 'function') {
                    if (mod.getCurrentChatId()) await mod.reloadCurrentChat();
                }
            } catch (_) {}
        },
    };

    // -----------------------------------------------------------------------
    // Feature resolution
    // -----------------------------------------------------------------------
    const Features = {
        sectionTitle(name) {
            const match = String(name || '').match(/\*\*\s*([^*]+?)\s*\*\*/);
            return match?.[1]?.trim() || null;
        },

        isDivider(name) {
            const value = String(name || '').replace(/\s+/g, '');
            if (value.length < 6 || !/[─━—═⋅⋆☆★♱˚₊⁺‧୨୧]/u.test(value)) return false;
            const meaningful = value.match(/[\p{L}\p{N}]/gu)?.length || 0;
            const length = [...value].length;
            // Ornament dividers may contain Tibetan glyphs that Unicode labels as
            // letters. Their text-to-decoration ratio is still very low.
            return meaningful <= 1 || meaningful / length <= 0.28;
        },

        assignPresetSections(prompts) {
            let base = { id: 'preset-core', title: 'Preset หลัก' };
            let section = { ...base, order: -1 };
            let sectionOrder = 0;
            let part = 1;
            let dividerPending = false;
            return (prompts || []).map((prompt) => {
                const title = this.sectionTitle(prompt.name);
                if (title) {
                    base = { id: `preset:${String(prompt.identifier)}`, title };
                    section = { ...base, order: sectionOrder };
                    sectionOrder += 1;
                    part = 1;
                    dividerPending = false;
                    return { ...prompt, section, sectionHeader: true, sectionDivider: false };
                }

                const divider = this.isDivider(prompt.name);
                if (divider) {
                    dividerPending = true;
                    return { ...prompt, section, sectionHeader: false, sectionDivider: true };
                }

                if (dividerPending) {
                    part += 1;
                    section = {
                        id: `${base.id}:part:${part}`,
                        title: `${base.title} · ส่วน ${part}`,
                        order: sectionOrder,
                    };
                    sectionOrder += 1;
                    dividerPending = false;
                }
                return { ...prompt, section, sectionHeader: false, sectionDivider: false };
            });
        },

        async resolve() {
            const [{ prompts }, regexAll] = await Promise.all([
                Prompts.listLive(),
                Engine.listAll(),
            ]);

            // Preserve the preset's own prompt_order and **section headers**.
            // One real prompt = one row. No keyword merging or guessed P↔R pair.
            const sectionedPrompts = this.assignPresetSections(prompts);
            const promptPool = sectionedPrompts.filter((p) =>
                p.name && p.inOrder && !p.marker && !p.sectionHeader && !p.sectionDivider
            );
            const packs = promptPool.map((prompt) => ({
                def: {
                    id: String(prompt.identifier),
                    title: prompt.name,
                    icon: 'fa-message',
                },
                prompts: [prompt],
                regex: [],
                state: prompt.enabled ? 'on' : 'off',
                promptOn: prompt.enabled ? 1 : 0,
                regexOn: 0,
                totalBits: 1,
                onBits: prompt.enabled ? 1 : 0,
                controlledTotal: 1,
                controlledOn: prompt.enabled ? 1 : 0,
                controlsRegex: false,
                mode: 'prompt',
                section: prompt.section,
                orderIndex: prompt.orderIndex,
            }));

            return {
                packs,
                leftoverPrompts: [],
                leftoverRegex: regexAll,
                promptPool,
                sectionedPrompts,
                regexAll,
            };
        },

        groupPacks(packs) {
            const map = new Map();
            for (const pack of packs) {
                const gid = pack.section.id;
                if (!map.has(gid)) {
                    const meta = {
                        title: pack.section.title,
                        icon: 'fa-layer-group',
                        order: pack.section.order,
                    };
                    map.set(gid, { id: gid, meta, items: [] });
                }
                map.get(gid).items.push(pack);
            }
            for (const group of map.values()) {
                group.items.sort((a, b) => a.orderIndex - b.orderIndex);
            }
            return [...map.values()].sort((a, b) => a.meta.order - b.meta.order);
        },

        async setPacks(packs, enabled, { reload = true, quiet = false, label = '' } = {}) {
            const list = packs || [];
            const pIds = [...new Set(list.flatMap((pack) => pack.prompts.map((p) => p.identifier)))];

            // Update the view-model synchronously. The live prompt_order mutation
            // happens in the same tap; disk persistence continues in background.
            for (const pack of list) {
                for (const prompt of pack.prompts) prompt.enabled = !!enabled;
                pack.promptOn = pack.prompts.filter((p) => p.enabled).length;
                pack.controlledOn = pack.promptOn;
                pack.controlledTotal = pack.prompts.length;
                pack.state = pack.controlledOn === 0 ? 'off'
                    : (pack.controlledOn === pack.controlledTotal ? 'on' : 'partial');
            }

            let pChanged = 0;
            if (pIds.length) pChanged = await Prompts.setEnabled(pIds, enabled, { render: false });

            if (!quiet) {
                Core.toast(
                    'success',
                    `${enabled ? 'เปิด' : 'ปิด'} ${label || 'Prompt'} · เปลี่ยน ${pChanged}`,
                );
            }
            if (reload) await Engine.reloadChatIfNeeded();
            return { pChanged, rChanged: 0 };
        },

        async setPack(pack, enabled, options = {}) {
            return this.setPacks([pack], enabled, { ...options, label: pack.def.title });
        },

        async setGroup(groupId, enabled) {
            const { packs } = await this.resolve();
            const subset = packs.filter((p) => p.section.id === groupId);
            if (!subset.length) throw new Error(`ไม่พบกลุ่ม ${groupId}`);
            const result = await this.setPacks(subset, enabled, {
                reload: false,
                quiet: false,
                label: `ทั้งหมวด ${subset[0]?.section?.title || groupId}`,
            });
            return { p: result.pChanged, r: result.rChanged };
        },

        async setByName(query, enabled) {
            const q = String(query || '').trim().toLowerCase();
            if (!q) throw new Error('ใส่ชื่อฟีเจอร์');
            const { packs } = await this.resolve();
            const hit = packs.find((p) => p.def.id === q || p.def.title.toLowerCase() === q)
                || packs.find((p) => p.def.title.toLowerCase().includes(q) || p.def.id.includes(q));
            if (!hit) throw new Error(`ไม่พบฟีเจอร์: ${query}`);
            await this.setPack(hit, enabled);
            return hit.def.title;
        },
    };

    // -----------------------------------------------------------------------
    // Profiles (prompt_order + regex disabled map)
    // -----------------------------------------------------------------------
    const Profiles = {
        list() {
            return Core.getSettings().profiles.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
        },
        get(id) {
            return Core.getSettings().profiles.find((p) => p.id === id) || null;
        },
        summary(p) {
            if (!p) return '';
            return `P${p.promptOn ?? '?'}/${p.promptTotal ?? '?'} R${p.regexOn ?? '?'}/${p.regexTotal ?? '?'}`;
        },
        async snapshot() {
            const { prompts, order } = await Prompts.listLive();
            const regexAll = await Engine.listAll();
            const oaiPreset = await Prompts.getOaiName();
            const promptOrder = (order?.length
                ? order
                : prompts.map((p) => ({ identifier: p.identifier, enabled: p.enabled }))
            ).filter((e) => e && e.identifier != null)
                .map((e) => ({ identifier: String(e.identifier), enabled: !!e.enabled }));

            const regex = regexAll.map((e) => ({
                id: e.script.id,
                name: e.script.scriptName || '',
                type: e.typeName,
                enabled: !e.script.disabled,
            }));

            return {
                promptOrder,
                regex,
                promptOn: promptOrder.filter((x) => x.enabled).length,
                promptTotal: promptOrder.length,
                regexOn: regex.filter((x) => x.enabled).length,
                regexTotal: regex.length,
                oaiPreset: oaiPreset ? String(oaiPreset) : null,
            };
        },
        async saveAs(name) {
            name = String(name || '').trim();
            if (!name) throw new Error('ตั้งชื่อโปรไฟล์ก่อน');
            const snap = await this.snapshot();
            const st = Core.getSettings();
            const now = Date.now();
            const p = { id: Core.uid(), name, created: now, updated: now, ...snap };
            st.profiles.push(p);
            st.lastProfileId = p.id;
            Core.saveSettings();
            return p;
        },
        async overwrite(id) {
            const p = this.get(id);
            if (!p) throw new Error('ไม่พบโปรไฟล์');
            const snap = await this.snapshot();
            Object.assign(p, snap, { updated: Date.now() });
            Core.saveSettings();
            return p;
        },
        async apply(id) {
            const p = this.get(id);
            if (!p) throw new Error('ไม่พบโปรไฟล์');

            // prompts
            if (Array.isArray(p.promptOrder) && p.promptOrder.length) {
                const pm = await Prompts.getManager();
                if (pm?.serviceSettings) {
                    const dummyId = pm.configuration?.promptOrder?.dummyId ?? 100001;
                    const char = pm.activeCharacter || { id: dummyId };
                    const lists = pm.serviceSettings.prompt_order || (pm.serviceSettings.prompt_order = []);
                    let list = lists.find((x) => String(x.character_id) === String(char.id))
                        || lists.find((x) => String(x.character_id) === String(dummyId));
                    if (!list) {
                        list = { character_id: char.id ?? dummyId, order: [] };
                        lists.push(list);
                    }
                    const snapIds = new Set(p.promptOrder.map((e) => e.identifier));
                    const next = p.promptOrder.map((e) => ({ identifier: e.identifier, enabled: !!e.enabled }));
                    for (const cur of list.order || []) {
                        if (!snapIds.has(cur.identifier)) {
                            next.push({ identifier: cur.identifier, enabled: !!cur.enabled });
                        }
                    }
                    list.order = next;
                    try {
                        if (typeof pm.saveServiceSettings === 'function') await pm.saveServiceSettings();
                        else Core.saveSettings();
                    } catch (_) { Core.saveSettings(); }
                    try { await pm.render?.(false); } catch (_) {}
                }
            }

            // regex soft-apply by id then name
            if (Array.isArray(p.regex) && p.regex.length) {
                const all = await Engine.listAll();
                const byId = new Map(all.map((e) => [e.script.id, e]));
                const byName = new Map(all.map((e) => [(e.script.scriptName || '').toLowerCase(), e]));
                const byType = new Map();
                for (const row of p.regex) {
                    let hit = row.id ? byId.get(row.id) : null;
                    if (!hit && row.name) hit = byName.get(String(row.name).toLowerCase());
                    if (!hit) continue;
                    const wantDisabled = !row.enabled;
                    if (!!hit.script.disabled === wantDisabled) continue;
                    hit.script.disabled = wantDisabled;
                    byType.set(hit.type, true);
                }
                for (const type of byType.keys()) {
                    await Engine.saveScripts(await Engine.getScriptsByType(type), type);
                }
            }

            const st = Core.getSettings();
            st.lastProfileId = id;
            Core.saveSettings();
            await Engine.reloadChatIfNeeded();
            return p;
        },
        remove(id) {
            const st = Core.getSettings();
            st.profiles = st.profiles.filter((x) => x.id !== id);
            if (st.lastProfileId === id) st.lastProfileId = null;
            Core.saveSettings();
        },
    };

    // -----------------------------------------------------------------------
    // Panel UI
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // Alerts — web-style popup cards (dedup by key, action buttons)
    // -----------------------------------------------------------------------
    const Alerts = {
        host: null,
        shown: new Map(), // key -> timestamp

        ensureHost() {
            if (this.host?.isConnected) return this.host;
            let el = document.getElementById('oh-alerts');
            if (!el) {
                el = document.createElement('div');
                el.id = 'oh-alerts';
                el.setAttribute('role', 'status');
                el.setAttribute('aria-live', 'polite');
                document.body.appendChild(el);
            }
            this.host = el;
            return el;
        },

        /**
         * @param {object} o
         * @param {string} o.key dedup key
         * @param {'warn'|'error'|'ok'|'info'} [o.level]
         * @param {string} o.title
         * @param {string} [o.body] plain text (escaped)
         * @param {Array<{label:string, icon?:string, primary?:boolean, run:function}>} [o.actions]
         * @param {number} [o.ttl] auto-dismiss ms (0 = sticky)
         * @param {number} [o.cooldown] ms before the same key can re-show
         */
        show(o) {
            const st = Core.getSettings();
            if (!st.enabled || !st.alerts) return null;
            const key = o.key || Core.uid();
            const cooldown = o.cooldown ?? 20000;
            const last = this.shown.get(key) || 0;
            if (Date.now() - last < cooldown) return null;
            this.shown.set(key, Date.now());

            const host = this.ensureHost();
            host.querySelector(`.oh-alert[data-key="${CSS.escape(key)}"]`)?.remove();

            const card = document.createElement('div');
            card.className = `oh-alert ${o.level || 'warn'}`;
            card.dataset.key = key;
            const icon = { warn: 'fa-triangle-exclamation', error: 'fa-circle-xmark', ok: 'fa-circle-check', info: 'fa-circle-info' }[o.level || 'warn'];
            card.innerHTML = `
                <div class="oh-alert-icon"><i class="fa-solid ${icon}"></i></div>
                <div class="oh-alert-main">
                    <div class="oh-alert-title"></div>
                    ${o.body ? '<div class="oh-alert-body"></div>' : ''}
                    <div class="oh-alert-actions"></div>
                </div>
                <div class="oh-alert-close" role="button" tabindex="0" aria-label="ปิด"><i class="fa-solid fa-xmark"></i></div>
            `;
            card.querySelector('.oh-alert-title').textContent = o.title || '';
            if (o.body) card.querySelector('.oh-alert-body').textContent = o.body;

            const actionsHost = card.querySelector('.oh-alert-actions');
            for (const a of (o.actions || [])) {
                const btn = document.createElement('div');
                btn.className = 'menu_button menu_button_icon oh-alert-btn' + (a.primary ? ' primary' : '');
                btn.innerHTML = a.icon ? `<i class="fa-solid ${a.icon}"></i>` : '';
                const span = document.createElement('span');
                span.textContent = a.label;
                btn.appendChild(span);
                btn.addEventListener('click', async () => {
                    btn.classList.add('disabled');
                    try { await a.run(); } catch (err) { Core.toast('error', err?.message || String(err)); }
                    finally { this.dismiss(card); }
                });
                actionsHost.appendChild(btn);
            }
            if (!actionsHost.children.length) actionsHost.remove();

            const close = () => this.dismiss(card);
            card.querySelector('.oh-alert-close')?.addEventListener('click', close);
            card.querySelector('.oh-alert-close')?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') close();
            });

            host.appendChild(card);
            requestAnimationFrame(() => card.classList.add('in'));

            const ttl = o.ttl ?? (o.actions?.length ? 0 : 9000);
            if (ttl > 0) setTimeout(close, ttl);
            return card;
        },

        dismiss(card) {
            if (!card?.isConnected) return;
            card.classList.remove('in');
            setTimeout(() => card.remove(), 180);
        },

        clear(key) {
            if (key) {
                this.host?.querySelector(`.oh-alert[data-key="${CSS.escape(key)}"]`)?.remove();
                this.shown.delete(key);
            } else {
                this.host?.replaceChildren();
                this.shown.clear();
            }
        },
    };

    const PatchNotice = {
        parseVersion(value) {
            const match = String(value || '').match(/(?:^|[^\d])v?(\d+)\.(\d+)(?:\.(\d+))?/i);
            return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
        },

        compare(a, b) {
            for (let i = 0; i < 3; i += 1) {
                const delta = (a?.[i] || 0) - (b?.[i] || 0);
                if (delta) return Math.sign(delta);
            }
            return 0;
        },

        show({ level, title, body, primary = false }) {
            return Alerts.show({
                key: 'patch-status',
                level,
                cooldown: 0,
                ttl: 0,
                title,
                body,
                actions: [{
                    label: 'ดูต้นโพสต์ Discord',
                    icon: 'fa-arrow-up-right-from-square',
                    primary,
                    run: () => window.open(PATCH_NOTICE.sourceUrl, '_blank', 'noopener,noreferrer'),
                }],
            });
        },

        async check() {
            if (!PATCH_NOTICE?.id || !PATCH_NOTICE?.version || !PATCH_NOTICE?.sourceUrl) return null;
            try {
                const preset = await Prompts.getOaiName();
                const current = this.parseVersion(preset);
                const latest = this.parseVersion(PATCH_NOTICE.version);
                const isOmega = /omega/i.test(String(preset || ''));
                const commonBody = `กำลังใช้: ${preset || 'ไม่ทราบชื่อ'}\nOmega ล่าสุด: ${PATCH_NOTICE.fileName}`;

                if (!current || !latest) {
                    return this.show({
                        level: 'info',
                        title: `มีประกาศแพตช์: ${PATCH_NOTICE.title}`,
                        body: `${commonBody}\nอ่านเลขเวอร์ชันจากชื่อ preset ปัจจุบันไม่ได้`,
                    });
                }

                const relation = this.compare(current, latest);
                if (isOmega && relation < 0) {
                    return this.show({
                        level: 'warn', primary: true,
                        title: `Omega ที่ใช้อยู่เก่ากว่า ${PATCH_NOTICE.version}`,
                        body: `${commonBody}\nควรดาวน์โหลดแพตช์ใหม่แล้วเปิดแชตใหม่`,
                    });
                }
                if (isOmega && relation === 0) {
                    return this.show({
                        level: 'ok',
                        title: `Omega ${PATCH_NOTICE.version} เป็นเวอร์ชันล่าสุดแล้ว`,
                        body: commonBody,
                    });
                }
                if (isOmega && relation > 0) {
                    return this.show({
                        level: 'info',
                        title: 'Omega ที่ใช้อยู่ใหม่กว่าประกาศล่าสุด',
                        body: `${commonBody}\nยังไม่ต้องย้อนกลับไปใช้เวอร์ชันเก่า`,
                    });
                }

                const relationText = relation > 0 ? 'ใหม่กว่า' : (relation < 0 ? 'เก่ากว่า' : 'เท่ากับ');
                return this.show({
                    level: relation < 0 ? 'warn' : 'info',
                    title: `JB ปัจจุบัน ${relationText} Omega ${PATCH_NOTICE.version}`,
                    body: `${commonBody}\nเปรียบเทียบจากเลขเวอร์ชันในชื่อ preset`,
                    primary: relation < 0,
                });
            } catch (err) {
                console.warn(LOG, 'ตรวจเวอร์ชัน JB/Omega ไม่สำเร็จ', err);
                return null;
            }
        },
    };

    // -----------------------------------------------------------------------
    // Doctor — Reasoning Formatting vs current model
    // -----------------------------------------------------------------------
    const Doctor = {
        puMod: null,
        async powerUser() {
            if (!this.puMod) this.puMod = await import('/scripts/power-user.js');
            return this.puMod?.power_user || null;
        },

        async currentModel() {
            try {
                const mod = await Prompts.load();
                const m = mod?.getChatCompletionModel?.();
                if (m) return String(m);
                return String(mod?.oai_settings?.google_model || '');
            } catch (_) { return ''; }
        },

        /**
         * Which rule applies to a model id.
         * @returns {{rule:object|null, why:string}}
         */
        classify(model) {
            const m = String(model || '').toLowerCase();
            if (!m) return { rule: null, why: 'ไม่รู้จักโมเดล' };
            if (!m.includes('gemini')) return { rule: null, why: 'ไม่ใช่ Gemini — ข้ามการเช็ค' };

            // family version, e.g. gemini-3.6-flash → 3.6
            const ver = parseFloat((m.match(/gemini[-_ ]?(\d+(?:\.\d+)?)/) || [])[1] ?? 'NaN');
            const isLite = /flash[-_ ]?lite/.test(m);

            if (!Number.isFinite(ver)) return { rule: null, why: 'อ่านเวอร์ชันไม่ออก' };
            // 3.6+ (any variant) และ 3.5 flash-lite = ไม่ prefill
            if (ver >= 3.6) return { rule: MODEL_RULES.noPrefill, why: `gemini ${ver}` };
            if (ver >= 3.5 && isLite) return { rule: MODEL_RULES.noPrefill, why: `gemini ${ver} flash-lite` };
            // 3.5 flash / 3.1 pro ลงมา = prefill
            return { rule: MODEL_RULES.prefill, why: `gemini ${ver}` };
        },

        /** Read live Reasoning Formatting + Start Reply With state. */
        async readState() {
            const pu = await this.powerUser();
            const r = pu?.reasoning || {};
            return {
                pu,
                prefix: String(r.prefix ?? ''),
                suffix: String(r.suffix ?? ''),
                autoParse: !!r.auto_parse,
                startReplyWith: String(pu?.user_prompt_bias ?? ''),
                showPrefix: !!pu?.show_user_prompt_bias,
            };
        },

        /**
         * @returns {Promise<{model:string, rule:object|null, why:string, issues:Array<{id:string,msg:string,fixable:boolean}>, state:object}>}
         */
        /** Omega / 5EX only — other presets don't use the planning block. */
        async isSupportedPreset() {
            const name = await Prompts.getOaiName();
            return { name: name || '', supported: SUPPORTED_PRESET.test(name || '') };
        },

        async check() {
            const model = await this.currentModel();
            const { rule, why } = this.classify(model);
            const state = await this.readState();
            const preset = await this.isSupportedPreset();
            const issues = [];

            // not an Omega/5EX preset → this whole feature does not apply
            if (!preset.supported) {
                return { model, rule: null, why: `preset ${preset.name || '(ไม่รู้)'} ไม่ใช่ Omega/5EX — ข้าม`, issues, state, preset };
            }

            // both fields must literally be <planning> / </planning>
            if (state.prefix !== REASONING_TEMPLATE.prefix || state.suffix !== REASONING_TEMPLATE.suffix) {
                issues.push({
                    id: 'template',
                    msg: `Reasoning Formatting ต้องเป็น ${REASONING_TEMPLATE.prefix} / ${REASONING_TEMPLATE.suffix} (ตอนนี้: ${state.prefix || 'ว่าง'} / ${state.suffix || 'ว่าง'})`,
                    fixable: true,
                });
            }
            if (!state.autoParse) {
                issues.push({
                    id: 'autoParse',
                    msg: 'Auto-Parse ปิดอยู่ — ST จะไม่ตัด reasoning block ออกจากข้อความ',
                    fixable: true,
                });
            }

            if (rule) {
                // always the canonical tag, never whatever is currently typed in the field
                const want = rule.startReplyWith === 'prefix' ? REASONING_TEMPLATE.prefix : '';
                const have = state.startReplyWith.trim();
                if (want && have !== want) {
                    issues.push({
                        id: 'srwMissing',
                        msg: `โมเดลนี้ต้องใส่ "${want}" ใน Start Reply With (ตอนนี้: ${have || 'ว่าง'})`,
                        fixable: true,
                    });
                }
                if (!want && have) {
                    issues.push({
                        id: 'srwExtra',
                        msg: `โมเดลนี้ต้องเอา "${have}" ออกจาก Start Reply With`,
                        fixable: true,
                    });
                }
                if (state.showPrefix !== rule.showPrefix) {
                    issues.push({
                        id: 'showPrefix',
                        msg: `Show reply prefix in chat ควร${rule.showPrefix ? 'ติ๊ก' : 'เอาติ๊กออก'}`,
                        fixable: true,
                    });
                }
            }

            return { model, rule, why, issues, state, preset };
        },

        /** Apply the rule for the current model. */
        async fix() {
            const { rule, state, model, preset } = await this.check();
            if (!preset?.supported) throw new Error(`preset ${preset?.name || ''} ไม่ใช่ Omega/5EX`);
            if (!rule) throw new Error(`ไม่มีกฎสำหรับโมเดล ${model || '(ไม่รู้)'}`);
            const pu = state.pu;
            if (!pu) throw new Error('เข้าถึง power_user ไม่ได้');

            // template is fixed for both model rules
            pu.reasoning.prefix = REASONING_TEMPLATE.prefix;
            pu.reasoning.suffix = REASONING_TEMPLATE.suffix;
            pu.reasoning.auto_parse = true;

            const srw = rule.startReplyWith === 'prefix' ? REASONING_TEMPLATE.prefix : '';
            pu.user_prompt_bias = srw;
            pu.show_user_prompt_bias = rule.showPrefix;

            // mirror the native controls (they are the source of truth for the user)
            try {
                $('#reasoning_prefix').val(REASONING_TEMPLATE.prefix);
                $('#reasoning_suffix').val(REASONING_TEMPLATE.suffix);
                $('#start_reply_with').val(srw);
                $('#chat-show-reply-prefix-checkbox').prop('checked', rule.showPrefix);
                $('#reasoning_auto_parse').prop('checked', true);
            } catch (_) {}

            Core.getContext()?.saveSettingsDebounced?.();
            await Engine.reloadChatIfNeeded(true);
            return rule;
        },

        /** Check + popup. Silent when everything is fine. */
        async audit({ quiet = true, cooldown } = {}) {
            const st = Core.getSettings();
            if (!st.enabled || !st.checkFormatting) return null;
            let res;
            try { res = await this.check(); } catch (_) { return null; }
            if (!res.issues.length) {
                Alerts.clear('doctor');
                if (!quiet) {
                    Alerts.show({
                        key: 'doctor-ok', level: 'ok', cooldown: 0, ttl: 5000,
                        title: 'Reasoning Formatting ถูกต้อง',
                        body: `${res.model || 'model'} · ${res.rule?.label || res.why}`,
                    });
                }
                return res;
            }

            if (st.autoFixFormatting && res.issues.every((i) => i.fixable)) {
                try {
                    await this.fix();
                    Alerts.show({
                        key: 'doctor-autofix', level: 'ok', ttl: 6000, cooldown: 5000,
                        title: 'ปรับ Reasoning Formatting ให้ตรงโมเดลแล้ว',
                        body: `${res.model} → ${res.rule?.label || ''}`,
                    });
                    return res;
                } catch (_) { /* fall through to popup */ }
            }

            const fixable = res.issues.some((i) => i.fixable);
            Alerts.show({
                key: 'doctor',
                level: 'warn',
                cooldown: cooldown ?? 60000,
                ttl: 0,
                title: `ตั้งค่า Reasoning ไม่ตรงกับ ${res.model || 'โมเดลปัจจุบัน'}`,
                body: `${res.rule?.label || res.why}\n· ${res.issues.map((i) => i.msg).join('\n· ')}`,
                actions: [
                    ...(fixable ? [{ label: 'แก้ให้เลย', icon: 'fa-wand-magic-sparkles', primary: true, run: () => this.fix() }] : []),
                    { label: 'เปิดแผง', icon: 'fa-sliders', run: () => Panel.show() },
                ],
            });
            return res;
        },
    };

    // -----------------------------------------------------------------------
    // Watch — truncated reasoning block / regex leak in the last message
    // -----------------------------------------------------------------------
    const Watch = {
        /**
         * @param {string} text message text
         * @param {{prefix:string,suffix:string}} tpl
         */
        inspect(text, tpl) {
            const msg = String(text || '');
            const problems = [];
            const prefix = tpl.prefix || '';
            const suffix = tpl.suffix || '';

            if (prefix && suffix) {
                const opens = msg.split(prefix).length - 1;
                const closes = msg.split(suffix).length - 1;
                // ST strips a parsed block; anything left means the block never closed
                if (opens > closes) {
                    problems.push({
                        id: 'thinkUnclosed',
                        msg: `พบ ${prefix} ไม่ปิดด้วย ${suffix} (${opens} เปิด / ${closes} ปิด) — reasoning ค้างอยู่ในข้อความ`,
                    });
                } else if (opens && opens === closes) {
                    problems.push({
                        id: 'thinkNotParsed',
                        msg: `${prefix}…${suffix} ยังโชว์ในข้อความ — Auto-Parse หรือ template ไม่ตรง`,
                    });
                }
            }

            // Unclosed Omega UI blocks → regex ตัดไม่ครบ
            const tags = new Map();
            for (const m of msg.matchAll(/<\s*(\/?)\s*([A-Za-z][\w:-]{1,40})[^>]*?(\/?)\s*>/g)) {
                const [, slash, rawName, selfClose] = m;
                const name = rawName.toLowerCase();
                if (HTML_TAGS.has(name) || selfClose) continue;
                const cur = tags.get(name) || { open: 0, close: 0, raw: rawName };
                if (slash) cur.close += 1; else cur.open += 1;
                tags.set(name, cur);
            }
            const dangling = [...tags.entries()]
                .filter(([, v]) => v.open !== v.close)
                .map(([, v]) => v.raw);
            if (dangling.length) {
                problems.push({
                    id: 'blockUnclosed',
                    msg: `แท็กไม่ครบคู่: ${dangling.slice(0, 5).join(', ')} — regex อาจ render/ตัดไม่ครบ`,
                });
            }
            return problems;
        },

        async lastMessage() {
            const ctx = Core.getContext();
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || !chat.length) return null;
            for (let i = chat.length - 1; i >= 0; i -= 1) {
                const m = chat[i];
                if (m && !m.is_user && !m.is_system) return m;
            }
            return null;
        },

        async run() {
            const st = Core.getSettings();
            if (!st.enabled || !st.watchReasoning) return null;
            // Omega/5EX only
            if (!(await Doctor.isSupportedPreset()).supported) return null;
            const msg = await this.lastMessage();
            if (!msg) return null;

            // template is fixed, so a broken think is detectable without reading settings
            const problems = this.inspect(msg.mes, REASONING_TEMPLATE);
            if (!problems.length) {
                Alerts.clear('watch');
                return [];
            }
            Alerts.show({
                key: 'watch',
                level: 'warn',
                ttl: 0,
                cooldown: 0, // think broken → pop immediately, every time
                title: 'Reasoning / regex ไม่ครบในข้อความล่าสุด',
                body: problems.map((p) => `· ${p.msg}`).join('\n'),
                actions: [
                    { label: 'แก้ตั้งค่าให้เลย', icon: 'fa-wand-magic-sparkles', primary: true, run: () => Doctor.fix() },
                    { label: 'เช็คตั้งค่า', icon: 'fa-stethoscope', run: () => Doctor.audit({ quiet: false, cooldown: 0 }) },
                ],
            });
            return problems;
        },
    };

    const Panel = {
        isOpen: false,
        root: null,
        search: '',
        cache: null,
        _onKey: null,
        _searchTimer: null,

        async show() {
            if (this.isOpen) {
                await this.refresh();
                return;
            }
            this.isOpen = true;
            this.search = Core.getSettings().lastSearch || '';
            this.mount();
            await this.refresh();
        },
        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            if (this._searchTimer) {
                clearTimeout(this._searchTimer);
                this._searchTimer = null;
                const s = Core.getSettings();
                s.lastSearch = this.search;
                Core.saveSettings();
            }
            if (this._onKey) {
                document.removeEventListener('keydown', this._onKey);
                this._onKey = null;
            }
            this.root?.remove();
            this.root = null;
            document.body.classList.remove('oh-no-scroll', 'oh-open');
        },
        toggle() {
            if (this.isOpen) this.close();
            else this.show();
        },

        mount() {
            this.root?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'oh-overlay';
            // Inline height fallbacks help iOS/Android when 100% of body is wrong
            overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;height:100dvh;z-index:3200;';
            overlay.innerHTML = `
                <div id="oh-panel" role="dialog" aria-modal="true" aria-label="Omega Helper">
                    <div id="oh-panel-header">
                        <h3><i class="fa-solid fa-bolt"></i> Omega Helper</h3>
                        <span class="oh-meta" id="oh-header-meta" title="version">v${VERSION}</span>
                        <div class="menu_button menu_button_icon" id="oh-close" title="ปิด" aria-label="ปิด">
                            <i class="fa-solid fa-xmark"></i>
                        </div>
                    </div>
                    <div id="oh-panel-body">
                        <div class="oh-tabs" role="tablist">
                            <div class="oh-tab active" data-tab="features" role="tab" title="Prompt ตามหมวดใน preset">Prompt</div>
                            <div class="oh-tab" data-tab="regex" role="tab" title="Regex ของ preset/global/scoped">Regex</div>
                        </div>
                        <div class="oh-toolbar">
                            <label class="oh-search-box" for="oh-search">
                                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                                <input type="search" id="oh-search" class="text_pole" placeholder="ค้นหาฟีเจอร์หรือ Regex..." enterkeyhint="search" autocomplete="off" />
                            </label>
                            <select id="oh-profile-select" class="text_pole" title="โปรไฟล์"></select>
                        </div>
                        <div class="oh-toolbar oh-profile-actions">
                            <div class="menu_button menu_button_icon" id="oh-profile-apply" title="ใช้โปรไฟล์"><i class="fa-solid fa-check"></i><span>ใช้</span></div>
                            <div class="menu_button menu_button_icon" id="oh-profile-save" title="เซฟชุด"><i class="fa-solid fa-floppy-disk"></i><span>เซฟชุด</span></div>
                            <div class="menu_button menu_button_icon" id="oh-profile-overwrite" title="ทับ"><i class="fa-solid fa-file-export"></i><span>ทับ</span></div>
                            <div class="menu_button menu_button_icon" id="oh-profile-del" title="ลบ"><i class="fa-solid fa-trash"></i></div>
                            <div class="menu_button menu_button_icon" id="oh-refresh" title="รีเฟรช"><i class="fa-solid fa-rotate"></i></div>
                        </div>
                        <p class="oh-status" id="oh-status">กำลังโหลด...</p>
                        <p class="oh-status oh-doctor-line" id="oh-doctor-line" hidden></p>
                        <div id="oh-content"></div>
                    </div>
                    <div id="oh-panel-footer">
                        <div class="menu_button menu_button_icon" id="oh-allow-preset"><i class="fa-solid fa-unlock"></i><span>Allow preset regex</span></div>
                        <div class="menu_button menu_button_icon" id="oh-doctor" title="เช็ค Reasoning Formatting กับโมเดลปัจจุบัน"><i class="fa-solid fa-stethoscope"></i><span>เช็ค Reasoning</span></div>
                        <div class="menu_button menu_button_icon" id="oh-open-pm" title="เลื่อนไป Prompt Manager"><i class="fa-solid fa-list-check"></i><span>Prompt Manager</span></div>
                        <div class="menu_button menu_button_icon" id="oh-open-native"><i class="fa-solid fa-code"></i><span>Regex เต็ม</span></div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.body.classList.add('oh-no-scroll', 'oh-open');
            this.root = overlay;

            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
            overlay.querySelector('#oh-close')?.addEventListener('click', () => this.close());

            const st = Core.getSettings();
            overlay.querySelectorAll('.oh-tab').forEach((tab) => {
                if (tab.dataset.tab === st.activeTab) tab.classList.add('active');
                else if (st.activeTab) tab.classList.remove('active');
                tab.addEventListener('click', () => {
                    overlay.querySelectorAll('.oh-tab').forEach((t) => t.classList.remove('active'));
                    tab.classList.add('active');
                    const s = Core.getSettings();
                    s.activeTab = tab.dataset.tab;
                    Core.saveSettings();
                    this.render();
                });
            });
            // ensure one active
            if (!overlay.querySelector('.oh-tab.active')) {
                overlay.querySelector('.oh-tab[data-tab="features"]')?.classList.add('active');
            }

            const searchEl = overlay.querySelector('#oh-search');
            if (searchEl) {
                searchEl.value = this.search;
                searchEl.addEventListener('input', (e) => {
                    this.search = e.target.value || '';
                    // A short debounce avoids rebuilding a long prompt/regex list
                    // for every keystroke on low-end phones.
                    clearTimeout(this._searchTimer);
                    this._searchTimer = setTimeout(() => {
                        this._searchTimer = null;
                        const s = Core.getSettings();
                        s.lastSearch = this.search;
                        Core.saveSettings();
                        this.render();
                    }, 140);
                });
            }

            overlay.querySelector('#oh-refresh')?.addEventListener('click', () => this.refresh());
            overlay.querySelector('#oh-profile-apply')?.addEventListener('click', async () => {
                const id = overlay.querySelector('#oh-profile-select')?.value;
                if (!id) return Core.toast('info', 'เลือกโปรไฟล์ก่อน');
                try {
                    const p = await Profiles.apply(id);
                    Core.toast('success', `ใช้: ${p.name}`);
                    await this.refresh();
                } catch (err) { Core.toast('error', err?.message || String(err)); }
            });
            overlay.querySelector('#oh-profile-save')?.addEventListener('click', async () => {
                let name = '';
                try { name = window.prompt('ชื่อโปรไฟล์ (prompt+regex)', '') || ''; } catch (_) { return; }
                try {
                    const p = await Profiles.saveAs(name);
                    Core.toast('success', `เซฟ: ${p.name}`);
                    this.fillProfiles();
                } catch (err) { Core.toast('error', err?.message || String(err)); }
            });
            overlay.querySelector('#oh-profile-overwrite')?.addEventListener('click', async () => {
                const id = overlay.querySelector('#oh-profile-select')?.value;
                if (!id) return Core.toast('info', 'เลือกโปรไฟล์ก่อน');
                try {
                    const p = await Profiles.overwrite(id);
                    Core.toast('success', `ทับ: ${p.name}`);
                    this.fillProfiles();
                } catch (err) { Core.toast('error', err?.message || String(err)); }
            });
            overlay.querySelector('#oh-profile-del')?.addEventListener('click', () => {
                const id = overlay.querySelector('#oh-profile-select')?.value;
                if (!id) return Core.toast('info', 'เลือกโปรไฟล์ก่อน');
                const p = Profiles.get(id);
                if (!(window.confirm?.(`ลบ “${p?.name || id}” ?`) ?? true)) return;
                Profiles.remove(id);
                Core.toast('info', 'ลบแล้ว');
                this.fillProfiles();
            });
            overlay.querySelector('#oh-allow-preset')?.addEventListener('click', async () => {
                try {
                    const r = await Engine.allowPreset();
                    Core.toast('success', `Allow: ${r.name}`);
                    await this.refresh();
                } catch (err) { Core.toast('error', err?.message || String(err)); }
            });
            overlay.querySelector('#oh-doctor')?.addEventListener('click', async () => {
                await Doctor.audit({ quiet: false, cooldown: 0 });
                await this.refreshDoctorLine();
            });
            overlay.querySelector('#oh-open-pm')?.addEventListener('click', async () => {
                try { await (await Prompts.getManager())?.render?.(false); } catch (_) {}
                this.close();
                try {
                    document.getElementById('leftNavDrawerIcon')?.click?.();
                } catch (_) {}
                setTimeout(() => {
                    document.getElementById('completion_prompt_manager')
                        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                }, 200);
                Core.toast('info', 'Prompt Manager อยู่ใต้ AI Response Configuration (Chat Completion)');
            });
            overlay.querySelector('#oh-open-native')?.addEventListener('click', () => {
                setTimeout(() => {
                    document.getElementById('regex_container')
                        ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
                }, 200);
            });

            if (Core.getSettings().closeOnEscape) {
                this._onKey = (e) => {
                    if (e.key === 'Escape' && this.isOpen) {
                        e.preventDefault();
                        this.close();
                    }
                };
                document.addEventListener('keydown', this._onKey);
            }
            this.fillProfiles();
        },

        fillProfiles() {
            if (!this.root) return;
            const sel = this.root.querySelector('#oh-profile-select');
            if (!sel) return;
            const st = Core.getSettings();
            const list = Profiles.list();
            const cur = sel.value || st.lastProfileId || '';
            sel.innerHTML = ['<option value="">— โปรไฟล์ (P+R) —</option>']
                .concat(list.map((p) => `<option value="${Core.escape(p.id)}">${Core.escape(p.name)} (${Core.escape(Profiles.summary(p))})</option>`))
                .join('');
            if (cur && list.some((p) => p.id === cur)) sel.value = cur;
            else sel.value = '';
        },

        async refresh() {
            if (!this.root) return;
            const status = this.root.querySelector('#oh-status');
            try {
                if (status) {
                    status.className = 'oh-status';
                    status.textContent = 'กำลังโหลด Chat Completion + regex...';
                }
                const resolved = await Features.resolve();
                const allow = await Engine.isPresetAllowed();
                const oai = await Prompts.getOaiName();
                const required = RequiredPrompts.inspect(resolved.promptPool);
                this.cache = { ...resolved, allow, oai, required };

                const onFeats = resolved.packs.filter((p) => p.state === 'on').length;
                const partial = resolved.packs.filter((p) => p.state === 'partial').length;
                const parts = [
                    `${resolved.packs.length} ฟีเจอร์`,
                    `${onFeats} เปิด`,
                    partial ? `${partial} รายการรอเปิดให้ครบ` : null,
                    required.total ? `Sigil ${required.on}/${required.total}` : null,
                    oai || null,
                    `${resolved.regexAll.length} regex`,
                ].filter(Boolean);

                if (status) {
                    if ((required.off.length > 0 && SUPPORTED_PRESET.test(String(oai || '')))
                        || (resolved.regexAll.some((e) => e.typeName === 'preset') && !allow.allowed)) {
                        status.className = 'oh-status warn';
                        const warnings = [
                            required.off.length ? `Sigil core ปิดอยู่ ${required.off.length}` : null,
                            resolved.regexAll.some((e) => e.typeName === 'preset') && !allow.allowed
                                ? 'ยังไม่ allow preset regex'
                                : null,
                        ].filter(Boolean);
                        status.textContent = `${parts.join(' · ')} — ${warnings.join(' · ')}`;
                    } else {
                        status.className = 'oh-status ok';
                        status.textContent = parts.join(' · ');
                    }
                }
                const meta = this.root.querySelector('#oh-header-meta');
                if (meta) meta.textContent = `${onFeats}/${resolved.packs.length}`;
                this.fillProfiles();
                this.render();
                this.refreshDoctorLine();
            } catch (err) {
                console.error(LOG, err);
                if (status) {
                    status.className = 'oh-status warn';
                    status.textContent = `โหลดไม่สำเร็จ: ${err?.message || err}`;
                }
            }
        },

        async refreshDoctorLine() {
            const line = this.root?.querySelector('#oh-doctor-line');
            if (!line) return;
            const st = Core.getSettings();
            if (!st.checkFormatting) { line.hidden = true; return; }
            let res;
            try { res = await Doctor.check(); } catch (_) { line.hidden = true; return; }
            line.hidden = false;
            if (!res.rule) {
                line.className = 'oh-status oh-doctor-line';
                line.textContent = `Reasoning: ${res.why}`;
                return;
            }
            if (res.issues.length) {
                line.className = 'oh-status oh-doctor-line warn';
                line.textContent = `Reasoning ${res.model}: ${res.issues.length} จุดไม่ตรง — ${res.rule.label}`;
            } else {
                line.className = 'oh-status oh-doctor-line ok';
                line.textContent = `Reasoning ${res.model}: ตรงตาม ${res.rule.label}`;
            }
        },

        currentTab() {
            return this.root?.querySelector('.oh-tab.active')?.dataset?.tab
                || Core.getSettings().activeTab
                || 'features';
        },

        render() {
            if (!this.root || !this.cache) return;
            const host = this.root.querySelector('#oh-content');
            if (!host) return;
            if (this.currentTab() === 'regex') this.renderRegex(host);
            else this.renderFeatures(host);
        },

        packSubHtml(pack) {
            const order = Number.isFinite(pack.orderIndex) ? `ลำดับ ${pack.orderIndex + 1}` : 'Prompt';
            return `<span class="oh-badge prompt">Prompt</span> · ${order}`;
        },

        syncPackRow(row, pack) {
            row.className = `oh-row is-${pack.state}`;
            const sub = row.querySelector('.oh-sub');
            if (sub) sub.innerHTML = this.packSubHtml(pack);
            const wrap = row.querySelector('.oh-toggle-wrap');
            const lab = row.querySelector('.oh-toggle');
            const input = row.querySelector('.oh-toggle input');
            const text = row.querySelector('.oh-toggle-text');
            const modeLabel = 'Prompt นี้';
            wrap?.classList.remove('is-on', 'is-off', 'is-partial');
            wrap?.classList.add(`is-${pack.state}`);
            lab?.classList.remove('is-on', 'is-off', 'is-partial', 'busy');
            lab?.classList.add(`is-${pack.state}`);
            if (lab) {
                lab.title = pack.state === 'partial'
                    ? `เปิด ${modeLabel} ที่เหลือให้ครบ`
                    : `${pack.state === 'on' ? 'ปิด' : 'เปิด'} ${modeLabel}`;
                lab.setAttribute('aria-label', lab.title);
            }
            if (input) {
                input.checked = pack.state === 'on';
                input.indeterminate = pack.state === 'partial';
                input.disabled = false;
            }
            if (text) {
                text.textContent = pack.state === 'partial' ? 'เปิดให้ครบ'
                    : (pack.state === 'on' ? 'เปิด' : 'ปิด');
            }
        },

        updateFeatureMeta() {
            const packs = this.cache?.packs || [];
            const meta = this.root?.querySelector('#oh-header-meta');
            if (meta) meta.textContent = `${packs.filter((pack) => pack.state === 'on').length}/${packs.length}`;
        },

        openPromptEditor(pack) {
            const prompt = pack?.prompts?.[0];
            if (!prompt?.editable) return Core.toast('info', 'รายการนี้เป็น Prompt ระบบ จึงแก้ไขจากหน้านี้ไม่ได้');
            this.root?.querySelector('.oh-prompt-editor')?.remove();
            const editor = document.createElement('div');
            editor.className = 'oh-prompt-editor';
            editor.innerHTML = `
                <form class="oh-prompt-editor-card" aria-label="แก้ไข ${Core.escape(prompt.name)}">
                    <div class="oh-prompt-editor-head">
                        <div><b>แก้ไข Custom Prompt</b><small>${Core.escape(pack.section.title)}</small></div>
                        <button type="button" class="menu_button menu_button_icon oh-prompt-editor-close" aria-label="ยกเลิก" title="ยกเลิก"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                    <label>ชื่อ Prompt<input class="text_pole" name="name" required maxlength="160"></label>
                    <label>เนื้อหา Prompt<textarea class="text_pole" name="content" required rows="9"></textarea></label>
                    <div class="oh-prompt-editor-options">
                        <label>Role<select class="text_pole" name="role"><option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option></select></label>
                    </div>
                    <div class="oh-prompt-editor-actions">
                        <button type="button" class="menu_button oh-prompt-editor-cancel">ยกเลิก</button>
                        <button type="submit" class="menu_button oh-prompt-editor-save"><i class="fa-solid fa-floppy-disk"></i> บันทึก</button>
                    </div>
                </form>
            `;
            this.root?.querySelector('#oh-panel')?.appendChild(editor);
            const nameInput = editor.querySelector('input[name="name"]');
            const contentInput = editor.querySelector('textarea[name="content"]');
            const roleInput = editor.querySelector('select[name="role"]');
            if (nameInput) nameInput.value = prompt.name;
            if (contentInput) contentInput.value = prompt.content;
            if (roleInput) roleInput.value = prompt.role;
            const close = () => editor.remove();
            editor.addEventListener('click', (event) => { if (event.target === editor) close(); });
            editor.querySelector('.oh-prompt-editor-close')?.addEventListener('click', close);
            editor.querySelector('.oh-prompt-editor-cancel')?.addEventListener('click', close);
            editor.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                }
            });
            editor.querySelector('form')?.addEventListener('submit', async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const save = form.querySelector('.oh-prompt-editor-save');
                const data = new FormData(form);
                if (save) save.disabled = true;
                try {
                    const updated = await Prompts.update(prompt.identifier, {
                        name: data.get('name'),
                        content: data.get('content'),
                        role: data.get('role'),
                    });
                    close();
                    Core.toast('success', `บันทึก “${updated.name}” แล้ว`);
                    await this.refresh();
                } catch (err) {
                    Core.toast('error', err?.message || String(err));
                    if (save) save.disabled = false;
                }
            });
            setTimeout(() => contentInput?.focus(), 0);
        },

        renderFeatures(host) {
            const q = (this.search || '').trim().toLowerCase();
            const groups = Features.groupPacks(this.cache.packs || []);
            const st = Core.getSettings();
            host.innerHTML = '';

            if (!groups.length) {
                host.innerHTML = `<div class="oh-empty">ยังจับคู่ฟีเจอร์ไม่เจอ<br>โหลด Gemini Omega (Chat Completion) แล้วรีเฟรช</div>`;
                return;
            }

            const frag = document.createDocumentFragment();
            let shown = 0;

            for (const g of groups) {
                let items = g.items;
                if (q) {
                    items = items.filter((pack) =>
                        pack.def.title.toLowerCase().includes(q)
                        || pack.def.id.includes(q)
                        || pack.prompts.some((p) => p.name.toLowerCase().includes(q))
                        || pack.regex.some((e) => (e.script.scriptName || '').toLowerCase().includes(q))
                    );
                }
                if (!items.length) continue;

                const onCount = items.filter((i) => i.state === 'on').length;
                const collapsed = !!st.collapsedGroups['f:' + g.id] && !q;
                const section = document.createElement('div');
                section.className = 'oh-group' + (collapsed ? ' collapsed' : '');

                const head = document.createElement('div');
                head.className = 'oh-group-head';
                head.innerHTML = `
                    <div class="oh-group-title">
                        <b><i class="fa-solid ${Core.escape(g.meta.icon)}"></i> ${Core.escape(g.meta.title)}</b>
                        <small>${onCount}/${items.length} เปิด · ตามลำดับใน preset</small>
                    </div>
                    <div class="oh-group-actions">
                        <div class="menu_button menu_button_icon oh-g-on" title="เปิดทั้งกลุ่ม"><i class="fa-solid fa-toggle-on"></i></div>
                        <div class="menu_button menu_button_icon oh-g-off" title="ปิดทั้งกลุ่ม"><i class="fa-solid fa-toggle-off"></i></div>
                        <div class="menu_button menu_button_icon oh-g-fold"><i class="fa-solid fa-chevron-${collapsed ? 'down' : 'up'}"></i></div>
                    </div>
                `;
                head.querySelector('.oh-g-on')?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const pending = Features.setPacks(g.items, true, {
                        reload: false,
                        quiet: false,
                        label: `ทั้งหมวด ${g.meta.title}`,
                    });
                    this.renderFeatures(host);
                    this.updateFeatureMeta();
                    try {
                        await pending;
                    } catch (err) { Core.toast('error', err?.message || String(err)); }
                });
                head.querySelector('.oh-g-off')?.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const pending = Features.setPacks(g.items, false, {
                        reload: false,
                        quiet: false,
                        label: `ทั้งหมวด ${g.meta.title}`,
                    });
                    this.renderFeatures(host);
                    this.updateFeatureMeta();
                    try {
                        await pending;
                    } catch (err) { Core.toast('error', err?.message || String(err)); }
                });
                const fold = () => {
                    const next = !section.classList.contains('collapsed');
                    section.classList.toggle('collapsed', next);
                    st.collapsedGroups['f:' + g.id] = next;
                    Core.saveSettings();
                    const ic = head.querySelector('.oh-g-fold i');
                    if (ic) ic.className = `fa-solid fa-chevron-${next ? 'down' : 'up'}`;
                };
                head.querySelector('.oh-g-fold')?.addEventListener('click', (e) => { e.stopPropagation(); fold(); });
                head.querySelector('.oh-group-title')?.addEventListener('click', fold);

                const body = document.createElement('div');
                body.className = 'oh-group-body';

                for (const pack of items) {
                    shown += 1;
                    const row = document.createElement('div');
                    row.className = `oh-row is-${pack.state}`;

                    const nameBox = document.createElement('div');
                    nameBox.className = 'oh-name';
                    nameBox.innerHTML = `
                        <span class="oh-main">${Core.escape(pack.def.title)}</span>
                        <span class="oh-sub">${this.packSubHtml(pack)}</span>
                    `;

                    const editButton = pack.prompts[0]?.editable
                        ? document.createElement('button')
                        : null;
                    if (editButton) {
                        editButton.type = 'button';
                        editButton.className = 'menu_button menu_button_icon oh-row-edit';
                        editButton.title = 'แก้ไข Custom Prompt';
                        editButton.setAttribute('aria-label', `แก้ไข ${pack.def.title}`);
                        editButton.innerHTML = '<i class="fa-solid fa-pen"></i>';
                        editButton.addEventListener('click', () => this.openPromptEditor(pack));
                    }

                    const toggleWrap = document.createElement('div');
                    toggleWrap.className = `oh-toggle-wrap is-${pack.state}`;
                    const stateText = document.createElement('span');
                    stateText.className = 'oh-toggle-text';
                    stateText.textContent = pack.state === 'partial' ? 'เปิดให้ครบ'
                        : (pack.state === 'on' ? 'เปิด' : 'ปิด');

                    const lab = document.createElement('label');
                    lab.className = `oh-toggle is-${pack.state}`;
                    const modeLabel = 'Prompt นี้';
                    lab.title = pack.state === 'partial'
                        ? `เปิด ${modeLabel} ที่เหลือให้ครบ`
                        : `${pack.state === 'on' ? 'ปิด' : 'เปิด'} ${modeLabel}`;
                    lab.setAttribute('aria-label', lab.title);
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = pack.state === 'on';
                    if (pack.state === 'partial') input.indeterminate = true;
                    const slider = document.createElement('span');
                    slider.className = 'oh-slider';
                    lab.appendChild(input);
                    lab.appendChild(slider);
                    toggleWrap.appendChild(lab);
                    toggleWrap.appendChild(stateText);
                    stateText.addEventListener('click', () => { if (!input.disabled) input.click(); });

                    input.addEventListener('change', async () => {
                        const previousEnabled = pack.state === 'on';
                        // Mixed state is always a one-tap "complete setup" action.
                        const nextEnabled = pack.state === 'partial' ? true : !!input.checked;
                        input.checked = nextEnabled;
                        input.indeterminate = false;
                        // optimistic: state class follows the click before refresh lands
                        lab.classList.remove('is-on', 'is-off', 'is-partial');
                        lab.classList.add(nextEnabled ? 'is-on' : 'is-off');
                        toggleWrap.classList.remove('is-on', 'is-off', 'is-partial');
                        toggleWrap.classList.add(nextEnabled ? 'is-on' : 'is-off');
                        row.classList.remove('is-on', 'is-off', 'is-partial');
                        row.classList.add(nextEnabled ? 'is-on' : 'is-off');
                        stateText.textContent = nextEnabled ? 'เปิด' : 'ปิด';
                        try {
                            const pending = Features.setPack(pack, nextEnabled, { reload: false, quiet: false });
                            this.syncPackRow(row, pack);
                            await pending;
                            this.syncPackRow(row, pack);
                            const onNow = items.filter((item) => item.state === 'on').length;
                            const groupSummary = head.querySelector('.oh-group-title small');
                            if (groupSummary) {
                                groupSummary.textContent = `${onNow}/${items.length} เปิด · ตามลำดับใน preset`;
                            }
                            this.updateFeatureMeta();
                        } catch (err) {
                            for (const prompt of pack.prompts) prompt.enabled = previousEnabled;
                            pack.promptOn = previousEnabled ? pack.prompts.length : 0;
                            pack.controlledOn = pack.promptOn;
                            pack.state = previousEnabled ? 'on' : 'off';
                            input.checked = previousEnabled;
                            input.indeterminate = false;
                            lab.classList.remove('is-on', 'is-off');
                            lab.classList.add(`is-${pack.state}`);
                            toggleWrap.classList.remove('is-on', 'is-off', 'is-partial');
                            toggleWrap.classList.add(`is-${pack.state}`);
                            row.classList.remove('is-on', 'is-off', 'is-partial');
                            row.classList.add(`is-${pack.state}`);
                            stateText.textContent = pack.state === 'partial' ? 'เปิดให้ครบ'
                                : (pack.state === 'on' ? 'เปิด' : 'ปิด');
                            Core.toast('error', err?.message || String(err));
                        }
                    });

                    row.appendChild(nameBox);
                    if (editButton) row.appendChild(editButton);
                    row.appendChild(toggleWrap);
                    body.appendChild(row);
                }

                section.appendChild(head);
                section.appendChild(body);
                frag.appendChild(section);
            }

            if (!shown) {
                host.innerHTML = `<div class="oh-empty">ไม่พบ “${Core.escape(this.search)}”</div>`;
            } else {
                host.appendChild(frag);
            }
        },

        renderRegex(host) {
            const q = (this.search || '').trim().toLowerCase();
            const all = this.cache.regexAll || [];
            const items = q
                ? all.filter((e) => (e.script.scriptName || '').toLowerCase().includes(q))
                : all;
            host.innerHTML = '';
            if (!items.length) {
                host.innerHTML = `<div class="oh-empty">ไม่มี regex</div>`;
                return;
            }
            const body = document.createElement('div');
            body.className = 'oh-group-body';
            body.style.padding = '4px 0';
            for (const e of items) {
                const on = !e.script.disabled;
                const row = document.createElement('div');
                row.className = `oh-row is-${on ? 'on' : 'off'}`;
                const nameBox = document.createElement('div');
                nameBox.className = 'oh-name';
                nameBox.innerHTML = `
                    <span class="oh-main">${Core.escape(e.script.scriptName || e.script.id)}</span>
                    <span class="oh-sub"><span class="oh-badge ${Core.escape(e.typeName)}">${Core.escape(e.typeName)}</span></span>
                `;
                const lab = document.createElement('label');
                lab.className = `oh-toggle is-${on ? 'on' : 'off'}`;
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = on;
                const slider = document.createElement('span');
                slider.className = 'oh-slider';
                lab.appendChild(input);
                lab.appendChild(slider);
                input.addEventListener('change', async () => {
                    const previousEnabled = !e.script.disabled;
                    const nextEnabled = !!input.checked;
                    lab.classList.remove('is-on', 'is-off');
                    lab.classList.add(nextEnabled ? 'is-on' : 'is-off');
                    row.classList.remove('is-on', 'is-off');
                    row.classList.add(nextEnabled ? 'is-on' : 'is-off');
                    // Mutates the live regex object synchronously; save is queued.
                    const pending = Engine.setEnabled([e.script.id], nextEnabled);
                    try {
                        void Engine.reloadChatIfNeeded();
                        Core.toast('success', `${nextEnabled ? 'เปิด' : 'ปิด'}: ${e.script.scriptName}`);
                        await pending;
                        row.className = `oh-row is-${nextEnabled ? 'on' : 'off'}`;
                        lab.classList.remove('is-on', 'is-off');
                        lab.classList.add(nextEnabled ? 'is-on' : 'is-off');
                    } catch (err) {
                        e.script.disabled = previousEnabled ? false : true;
                        input.checked = previousEnabled;
                        lab.classList.remove('is-on', 'is-off');
                        lab.classList.add(`is-${previousEnabled ? 'on' : 'off'}`);
                        row.classList.remove('is-on', 'is-off');
                        row.classList.add(`is-${previousEnabled ? 'on' : 'off'}`);
                        Core.toast('error', err?.message || String(err));
                    }
                });
                row.appendChild(nameBox);
                row.appendChild(lab);
                body.appendChild(row);
            }
            const wrap = document.createElement('div');
            wrap.className = 'oh-group';
            wrap.appendChild(body);
            host.appendChild(wrap);
        },
    };

    // -----------------------------------------------------------------------
    // Settings + buttons
    // -----------------------------------------------------------------------
    const UI = {
        injectSettings() {
            if (document.getElementById(`${EXT_ID}-settings`)) return;
            const host = document.getElementById('extensions_settings')
                || document.getElementById('extensions_settings2');
            if (!host) return;
            const st = Core.getSettings();
            const wrap = document.createElement('div');
            wrap.id = `${EXT_ID}-settings`;
            wrap.className = 'oh-settings';
            wrap.innerHTML = `
                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b><span class="fa-solid fa-bolt"></span> Omega Helper</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <label class="checkbox_label" for="oh-enabled">
                            <input type="checkbox" id="oh-enabled" ${st.enabled ? 'checked' : ''} />
                            <span>Enable Omega Helper</span>
                        </label>
                        <label class="checkbox_label" for="oh-quick">
                            <input type="checkbox" id="oh-quick" ${st.showQuickButton ? 'checked' : ''} />
                            <span>ปุ่มลัดข้าง Send</span>
                        </label>
                        <label class="checkbox_label" for="oh-wand">
                            <input type="checkbox" id="oh-wand" ${st.showWandButton ? 'checked' : ''} />
                            <span>ปุ่มใน Wand menu</span>
                        </label>
                        <label class="checkbox_label" for="oh-reload">
                            <input type="checkbox" id="oh-reload" ${st.reloadChatAfterToggle ? 'checked' : ''} />
                            <span>Reload chat หลังสลับ (อัปเดตการ์ด UI)</span>
                        </label>

                        <div class="inline-drawer wide100p">
                            <div class="inline-drawer-toggle inline-drawer-header">
                                <b>แจ้งเตือน / ตรวจ Reasoning</b>
                                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                            </div>
                            <div class="inline-drawer-content">
                        <label class="checkbox_label" for="oh-alerts-enabled">
                            <input type="checkbox" id="oh-alerts-enabled" ${st.alerts ? 'checked' : ''} />
                                    <span>แจ้งเตือนแบบ popup ในหน้าเว็บ</span>
                                </label>
                                <label class="checkbox_label" for="oh-watch">
                                    <input type="checkbox" id="oh-watch" ${st.watchReasoning ? 'checked' : ''} />
                                    <span>จับ think/planning ไม่ครบ + แท็ก regex ขาด</span>
                                </label>
                                <label class="checkbox_label" for="oh-check-fmt">
                                    <input type="checkbox" id="oh-check-fmt" ${st.checkFormatting ? 'checked' : ''} />
                                    <span>เช็ค Reasoning Formatting ให้ตรงโมเดล</span>
                                </label>
                                <label class="checkbox_label" for="oh-autofix">
                                    <input type="checkbox" id="oh-autofix" ${st.autoFixFormatting ? 'checked' : ''} />
                                    <span>แก้ให้อัตโนมัติ (Start Reply With / prefix in chat)</span>
                                </label>
                                <small class="oh-hint">
                                    ทำงานกับ preset Omega / 5EX เท่านั้น<br>
                                    Prefix / Suffix = <code>&lt;planning&gt;</code> / <code>&lt;/planning&gt;</code> ทั้งสองแบบ<br>
                                    gemini 3.5 flash / 3.1 pro ลงมา → Start Reply With = <code>&lt;planning&gt;</code> + ติ๊ก Show reply prefix<br>
                                    gemini 3.5 flash-lite / 3.6 ขึ้นไป → Start Reply With ว่าง + เอาติ๊กออก
                                </small>
                                <div class="flex-container flexGap10 marginTop10">
                                    <div id="oh-check-now" class="menu_button menu_button_icon"><i class="fa-solid fa-stethoscope"></i><span>เช็คเลย</span></div>
                                </div>
                            </div>
                        </div>

                        <div class="flex-container flexGap10 marginTop10">
                            <div id="oh-open-now" class="menu_button menu_button_icon"><i class="fa-solid fa-sliders"></i><span>เปิดแผง</span></div>
                        </div>
                        <small class="oh-hint">
                            ใช้ API หลักของ SillyTavern เท่านั้น (Chat Completion Prompt Manager + Regex engine)
                            ไม่พึ่ง extension อื่น — ใครโหลด Omega OAI preset ก็ใช้คู่กันได้
                        </small>
                    </div>
                </div>
            `;
            host.appendChild(wrap);
            const bind = (id, key, after) => {
                wrap.querySelector(`#${id}`)?.addEventListener('change', (e) => {
                    const s = Core.getSettings();
                    s[key] = !!e.target.checked;
                    Core.saveSettings();
                    after?.(s);
                });
            };
            bind('oh-enabled', 'enabled', (s) => {
                this.syncQuickButton(s);
                this.syncWandButton(s);
            });
            bind('oh-quick', 'showQuickButton', (s) => this.syncQuickButton(s));
            bind('oh-wand', 'showWandButton', (s) => this.syncWandButton(s));
            bind('oh-reload', 'reloadChatAfterToggle');
            bind('oh-alerts-enabled', 'alerts', (s) => { if (!s.alerts) Alerts.clear(); });
            bind('oh-watch', 'watchReasoning', (s) => { if (!s.watchReasoning) Alerts.clear('watch'); });
            bind('oh-check-fmt', 'checkFormatting', (s) => {
                if (!s.checkFormatting) Alerts.clear('doctor');
                else Doctor.audit({ quiet: true, cooldown: 0 });
            });
            bind('oh-autofix', 'autoFixFormatting');
            wrap.querySelector('#oh-check-now')?.addEventListener('click', () => Doctor.audit({ quiet: false, cooldown: 0 }));
            wrap.querySelector('#oh-open-now')?.addEventListener('click', () => Panel.show());
        },

        injectQuickButton() {
            const settings = Core.getSettings();
            if (!settings.enabled || !settings.showQuickButton) {
                document.getElementById('oh-quick-btn-wrapper')?.remove();
                return;
            }
            if (typeof $ === 'undefined') return;
            if ($('#oh-quick-btn-wrapper').length) return;
            if (!$('#send_form').length) return;

            const wrapper = $(`
                <div id="oh-quick-btn-wrapper" title="Omega Helper — Prompt + Regex manager">
                    <div id="oh-quick-btn" role="button" tabindex="0" aria-label="Omega Helper">
                        <i class="fa-solid fa-bolt"></i>
                    </div>
                </div>
            `);
            const sendBut = $('#send_but');
            if (sendBut.length) sendBut.before(wrapper);
            else $('#send_form').append(wrapper);

            const el = document.getElementById('oh-quick-btn');
            if (!el) return;
            let ignoreMouseUntil = 0;
            const activate = (e) => {
                try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch (_) {}
                Panel.toggle();
            };
            el.addEventListener('touchend', (e) => {
                if (e.touches?.length > 0) return;
                ignoreMouseUntil = Date.now() + 700;
                activate(e);
            }, { passive: false });
            el.addEventListener('click', (e) => {
                if (Date.now() < ignoreMouseUntil) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                activate(e);
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(e);
            });
        },

        syncQuickButton(settings) {
            settings = settings || Core.getSettings();
            if (!settings.enabled || !settings.showQuickButton) {
                document.getElementById('oh-quick-btn-wrapper')?.remove();
            } else this.injectQuickButton();
        },

        injectWandButton() {
            const settings = Core.getSettings();
            const menu = document.getElementById('extensionsMenu');
            if (!menu) return;
            const existing = document.getElementById('oh-wand-btn');
            if (!settings.enabled || !settings.showWandButton) {
                existing?.remove();
                return;
            }
            if (existing) return;
            const btn = document.createElement('div');
            btn.id = 'oh-wand-btn';
            btn.className = 'list-group-item flex-container flexGap5 interactable';
            btn.tabIndex = 0;
            btn.setAttribute('role', 'listitem');
            btn.title = 'Omega Helper';
            btn.innerHTML = `
                <div class="fa-fw fa-solid fa-bolt extensionsMenuExtensionButton"></div>
                <span>Omega Helper</span>
            `;
            btn.addEventListener('click', () => Panel.show());
            menu.appendChild(btn);
        },

        syncWandButton(settings) {
            this.injectWandButton();
        },
    };

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
        const onMessage = () => later('watch', 0, () => Watch.run());
        if (et.MESSAGE_RECEIVED) es.on(et.MESSAGE_RECEIVED, onMessage);
        if (et.MESSAGE_SWIPED) es.on(et.MESSAGE_SWIPED, onMessage);
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
            if (tries >= 40) clearInterval(timer);
        }, 500);

        const observeTarget = document.getElementById('send_form')?.parentElement || document.body;
        try {
            const mo = new MutationObserver(() => {
                const s = Core.getSettings();
                if (s.enabled && s.showQuickButton && !document.getElementById('oh-quick-btn-wrapper')) UI.injectQuickButton();
                if (s.enabled && s.showWandButton && !document.getElementById('oh-wand-btn')) UI.injectWandButton();
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
