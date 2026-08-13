import { LOG, SUPPORTED_PRESET } from './config.js';

export function createFeatureServices({ Core, Prompts }) {
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
        CLICKABLE_INPUTS: {
            name: 'st-clickable-inputs',
            url: 'https://github.com/horse-armor/st-clickable-inputs',
        },

        needsClickableInputs(packs) {
            return (packs || []).some((pack) => (pack.prompts || []).some((prompt) => {
                const content = String(prompt?.content || '');
                return /st-clickable-inputs/i.test(content) && /<button\b/i.test(content);
            }));
        },

        async requireDependencies(packs, enabled) {
            if (!enabled || !this.needsClickableInputs(packs)) return null;
            const extensions = await import('/scripts/extensions.js');
            const found = extensions.findExtension?.(this.CLICKABLE_INPUTS.name);
            if (found?.enabled) return found;

            const state = found ? 'ติดตั้งแล้ว แต่ถูกปิดใช้งานอยู่' : 'ยังไม่ได้ติดตั้ง';
            const message = `${this.CLICKABLE_INPUTS.name} ${state} — ยังเปิดตัวเลือกแบบกดไม่ได้`;
            if (!found && window.confirm?.(`${message}\n\nเปิดหน้าติดตั้ง Extension หรือไม่?`)) {
                window.open?.(this.CLICKABLE_INPUTS.url, '_blank', 'noopener,noreferrer');
            }
            const error = new Error(message);
            error.code = 'OH_EXTENSION_REQUIRED';
            throw error;
        },

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
            if (enabled && this.needsClickableInputs(list)) await this.requireDependencies(list, true);
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
        undoProfile: null,
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
        async preview(id) {
            const profile = this.get(id);
            if (!profile) throw new Error('ไม่พบโปรไฟล์');
            const [{ prompts, order }, regexAll, currentPreset] = await Promise.all([
                Prompts.listLive(), Engine.listAll(), Prompts.getOaiName(),
            ]);
            const enabledById = new Map((order || [])
                .filter((entry) => entry?.identifier != null)
                .map((entry) => [String(entry.identifier), !!entry.enabled]));
            const liveIds = new Set((prompts || []).map((prompt) => String(prompt.identifier)));
            const promptRows = Array.isArray(profile.promptOrder) ? profile.promptOrder : [];
            const matchedPromptIds = promptRows
                .map((entry) => String(entry.identifier))
                .filter((promptId) => liveIds.has(promptId));
            const matchedSet = new Set(matchedPromptIds);
            const currentOrder = (order || []).map((entry) => String(entry?.identifier ?? ''))
                .filter((promptId) => matchedSet.has(promptId));

            const byId = new Map(regexAll.map((entry) => [String(entry.script.id), entry]));
            const byName = new Map(regexAll.map((entry) => [
                `${entry.typeName}:${(entry.script.scriptName || '').toLowerCase()}`, entry,
            ]));
            const regexRows = Array.isArray(profile.regex) ? profile.regex : [];
            let regexMatched = 0;
            let regexChanged = 0;
            for (const row of regexRows) {
                const hit = (row.id ? byId.get(String(row.id)) : null)
                    || (row.name ? byName.get(`${row.type}:${String(row.name).toLowerCase()}`) : null);
                if (!hit) continue;
                regexMatched += 1;
                if ((!hit.script.disabled) !== !!row.enabled) regexChanged += 1;
            }

            const savedPreset = profile.oaiPreset ? String(profile.oaiPreset) : '';
            const activePreset = currentPreset ? String(currentPreset) : '';
            return {
                profile,
                savedPreset,
                currentPreset: activePreset,
                presetMismatch: !!savedPreset && !!activePreset
                    && savedPreset.trim().toLowerCase() !== activePreset.trim().toLowerCase(),
                report: {
                    prompt: {
                        matched: matchedPromptIds.length,
                        total: promptRows.length,
                        changed: promptRows.filter((entry) => liveIds.has(String(entry.identifier))
                            && enabledById.get(String(entry.identifier)) !== !!entry.enabled).length,
                        reordered: matchedPromptIds.join('\n') !== currentOrder.join('\n'),
                    },
                    regex: { matched: regexMatched, total: regexRows.length, changed: regexChanged },
                },
            };
        },
        async applyProfile(p) {
            const report = {
                prompt: { matched: 0, total: Array.isArray(p.promptOrder) ? p.promptOrder.length : 0, changed: 0 },
                regex: { matched: 0, total: Array.isArray(p.regex) ? p.regex.length : 0, changed: 0 },
            };

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
                    const liveIds = new Set((pm.serviceSettings.prompts || [])
                        .map((prompt) => String(prompt?.identifier ?? '')).filter(Boolean));
                    const matched = p.promptOrder.filter((entry) => liveIds.has(String(entry.identifier)));
                    const promptById = new Map((pm.serviceSettings.prompts || [])
                        .map((prompt) => [String(prompt?.identifier ?? ''), prompt]));
                    await Features.requireDependencies([{
                        prompts: matched.filter((entry) => entry.enabled)
                            .map((entry) => promptById.get(String(entry.identifier))).filter(Boolean),
                    }], true);
                    report.prompt.matched = matched.length;
                    const enabledById = new Map((list.order || []).map((entry) => [
                        String(entry?.identifier ?? ''), !!entry?.enabled,
                    ]));
                    report.prompt.changed = matched.filter((entry) =>
                        enabledById.get(String(entry.identifier)) !== !!entry.enabled).length;
                    const snapIds = new Set(matched.map((e) => String(e.identifier)));
                    const next = matched.map((e) => ({ identifier: e.identifier, enabled: !!e.enabled }));
                    for (const cur of list.order || []) {
                        if (!snapIds.has(String(cur.identifier))) {
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
                const byId = new Map(all.map((e) => [String(e.script.id), e]));
                const byName = new Map(all.map((e) => [
                    `${e.typeName}:${(e.script.scriptName || '').toLowerCase()}`, e,
                ]));
                const byType = new Map();
                for (const row of p.regex) {
                    let hit = row.id ? byId.get(String(row.id)) : null;
                    if (!hit && row.name) hit = byName.get(`${row.type}:${String(row.name).toLowerCase()}`);
                    if (!hit) continue;
                    report.regex.matched += 1;
                    const wantDisabled = !row.enabled;
                    if (!!hit.script.disabled === wantDisabled) continue;
                    report.regex.changed += 1;
                    hit.script.disabled = wantDisabled;
                    byType.set(hit.type, true);
                }
                for (const type of byType.keys()) {
                    await Engine.saveScripts(await Engine.getScriptsByType(type), type);
                }
            }

            const st = Core.getSettings();
            if (this.get(p.id)) st.lastProfileId = p.id;
            Core.saveSettings();
            await Engine.reloadChatIfNeeded();
            return { profile: p, report };
        },
        async apply(id) {
            const p = this.get(id);
            if (!p) throw new Error('ไม่พบโปรไฟล์');
            this.undoProfile = {
                id: '__undo__', name: 'ก่อนใช้โปรไฟล์ล่าสุด', created: Date.now(), updated: Date.now(),
                ...await this.snapshot(),
            };
            return this.applyProfile(p);
        },
        async undoLast() {
            if (!this.undoProfile) throw new Error('ไม่มีการใช้โปรไฟล์ให้ย้อนกลับ');
            const undo = this.undoProfile;
            this.undoProfile = null;
            try {
                return await this.applyProfile(undo);
            } catch (err) {
                this.undoProfile = undo;
                throw err;
            }
        },
        remove(id) {
            const st = Core.getSettings();
            st.profiles = st.profiles.filter((x) => x.id !== id);
            if (st.lastProfileId === id) st.lastProfileId = null;
            Core.saveSettings();
        },
        exportData() {
            return {
                format: 'omega-helper-profiles',
                version: 1,
                exportedAt: new Date().toISOString(),
                profiles: this.list(),
            };
        },
        importData(data) {
            if (data?.format !== 'omega-helper-profiles' || data?.version !== 1 || !Array.isArray(data.profiles)) {
                throw new Error('ไฟล์นี้ไม่ใช่โปรไฟล์ Omega Helper ที่รองรับ');
            }
            if (!data.profiles.length) throw new Error('ไฟล์นี้ไม่มีโปรไฟล์');
            if (data.profiles.length > 200) throw new Error('ไฟล์มีโปรไฟล์มากเกิน 200 รายการ');

            const st = Core.getSettings();
            const ids = new Set(st.profiles.map((profile) => String(profile.id)));
            const imported = data.profiles.map((profile) => {
                const name = String(profile?.name || '').trim().slice(0, 160);
                if (!name || !Array.isArray(profile?.promptOrder) || !Array.isArray(profile?.regex)) {
                    throw new Error('ข้อมูลโปรไฟล์ไม่ครบ');
                }
                if (profile.promptOrder.length > 10000 || profile.regex.length > 10000) {
                    throw new Error(`โปรไฟล์ “${name}” มีรายการมากเกินไป`);
                }
                const promptOrder = profile.promptOrder
                    .filter((entry) => entry && entry.identifier != null)
                    .map((entry) => ({ identifier: String(entry.identifier), enabled: !!entry.enabled }));
                const regex = profile.regex
                    .filter((entry) => entry && (entry.id != null || entry.name))
                    .map((entry) => ({
                        id: entry.id == null ? null : String(entry.id),
                        name: String(entry.name || ''),
                        type: String(entry.type || ''),
                        enabled: !!entry.enabled,
                    }));
                let id = String(profile.id || '');
                if (!id || ids.has(id)) id = Core.uid();
                ids.add(id);
                const now = Date.now();
                return {
                    id,
                    name,
                    created: Number.isFinite(profile.created) ? profile.created : now,
                    updated: now,
                    promptOrder,
                    regex,
                    promptOn: promptOrder.filter((entry) => entry.enabled).length,
                    promptTotal: promptOrder.length,
                    regexOn: regex.filter((entry) => entry.enabled).length,
                    regexTotal: regex.length,
                    oaiPreset: profile.oaiPreset == null ? null : String(profile.oaiPreset),
                };
            });
            st.profiles.push(...imported);
            st.lastProfileId = imported[0].id;
            Core.saveSettings();
            return imported;
        },
    };

    // -----------------------------------------------------------------------
    // Panel UI
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // Alerts — web-style popup cards (dedup by key, action buttons)
    // -----------------------------------------------------------------------

    return { Engine, Features, Profiles };
}
