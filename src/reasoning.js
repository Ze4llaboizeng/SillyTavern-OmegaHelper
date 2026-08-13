import { LOG, MODEL_RULES, PATCH_NOTICE, REASONING_TEMPLATE, SUPPORTED_PRESET } from './config.js';

export function createReasoningServices(app) {
    const { Core, Prompts, Engine } = app;

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
                <button type="button" class="oh-alert-close" aria-label="ปิด"><i class="fa-solid fa-xmark"></i></button>
            `;
            card.querySelector('.oh-alert-title').textContent = o.title || '';
            if (o.body) card.querySelector('.oh-alert-body').textContent = o.body;

            const actionsHost = card.querySelector('.oh-alert-actions');
            for (const a of (o.actions || [])) {
                const btn = document.createElement('button');
                btn.type = 'button';
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
                actions: [
                    {
                        label: 'ดูต้นโพสต์ Discord',
                        icon: 'fa-arrow-up-right-from-square',
                        primary,
                        run: () => window.open(PATCH_NOTICE.sourceUrl, '_blank', 'noopener,noreferrer'),
                    },
                    {
                        label: 'คู่มือมือใหม่',
                        icon: 'fa-book-open',
                        run: async () => {
                            await app.Panel?.show?.();
                            if (app.Panel?.root) await app.Guide?.start?.(app.Panel.root);
                        },
                    },
                ],
            });
        },

        async check() {
            if (!PATCH_NOTICE?.id || !PATCH_NOTICE?.version || !PATCH_NOTICE?.sourceUrl) return null;
            try {
                const preset = await Prompts.getOaiName();
                if (!SUPPORTED_PRESET.test(String(preset || ''))) {
                    return { skipped: true, preset };
                }
                const current = this.parseVersion(preset);
                const latest = this.parseVersion(PATCH_NOTICE.version);
                const isOmega = /omega/i.test(String(preset || ''));
                const commonBody = `กำลังใช้: ${preset || 'ไม่ทราบชื่อ'}\nOmega ล่าสุด: ${PATCH_NOTICE.fileName}`;

                if (!current || !latest) {
                    return { preset, current, latest, relation: null };
                }

                const relation = this.compare(current, latest);
                if (relation < 0) {
                    return this.show({
                        level: 'warn', primary: true,
                        title: `${isOmega ? 'Omega' : 'JB'} ที่ใช้อยู่เก่ากว่า ${PATCH_NOTICE.version}`,
                        body: `${commonBody}\nควรดาวน์โหลดแพตช์ใหม่แล้วเปิดแชตใหม่`,
                    });
                }
                return { preset, current, latest, relation };
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
                    { label: 'เปิดแผง', icon: 'fa-sliders', run: () => app.Panel.show() },
                ],
            });
            return res;
        },
    };

    // -----------------------------------------------------------------------
    // Watch — inspect SillyTavern's native per-message reasoning block
    // -----------------------------------------------------------------------
    const Watch = {
        /** Read priority stages from the enabled engine prompts themselves. */
        priorityStages(prompts) {
            const stages = [];
            for (const prompt of prompts || []) {
                if (!prompt?.enabled || !String(prompt.content || '').includes('<planning>')) continue;
                for (const match of String(prompt.content).matchAll(/\/\/--\s*STAGE\s+(\d+)\s*\[([^\]]+)]\s*:\s*([^\r\n]+?)\s*--\/\//gi)) {
                    const [, number, marker, title] = match;
                    const label = marker.toLowerCase();
                    const priority = /strongest pull|freshest pull/.test(label)
                        ? 'strongest'
                        : /strong[- ]attn|strong attention/.test(label)
                            ? 'strong'
                            : /weak[- ]attn|weak attention/.test(label) ? 'weak' : null;
                    if (priority) stages.push({ number: Number(number), title: title.trim(), priority, engine: prompt.name });
                }
            }
            return stages;
        },

        inspectPlanning(reasoning, stages) {
            const expected = (stages || []).filter((stage) => stage.priority === 'strongest');
            if (!expected.length) return [];
            const text = String(reasoning || '');
            if (!text.trim()) {
                return [{
                    id: 'planningMissing',
                    msg: `ไม่พบเนื้อหา planning สำหรับตรวจสเตจสำคัญที่สุด: ${expected.map((s) => `${s.engine} · STAGE ${s.number}`).join(', ')}`,
                }];
            }
            const lower = text.toLowerCase();
            const missing = expected.filter((stage) =>
                !new RegExp(`\\b(?:stage|s)\\s*[-:#]?\\s*${stage.number}\\b`, 'i').test(text)
                && !lower.includes(stage.title.toLowerCase()));
            return missing.length ? [{
                id: 'strongestStageMissing',
                msg: `planning ขาดสเตจสำคัญที่สุด: ${missing.map((s) => `${s.engine} · STAGE ${s.number}: ${s.title}`).join(', ')}`,
            }] : [];
        },

        /** Resolve one exact reply, or every bot reply when a chat is loaded. */
        replies(messageId) {
            const ctx = Core.getContext();
            const chat = ctx?.chat;
            if (!Array.isArray(chat) || !chat.length) return [];
            const exact = Number(messageId);
            if (Number.isInteger(exact)) {
                if (exact === 0) return [];
                const message = chat[exact];
                return message && !message.is_user && !message.is_system ? [{ id: exact, message }] : [];
            }
            const replies = [];
            for (let id = 1; id < chat.length; id += 1) {
                const message = chat[id];
                if (message && !message.is_user && !message.is_system) replies.push({ id, message });
            }
            return replies;
        },

        /** Read the block shown under the supplied header; fall back to its saved message object. */
        reasoning(id, message) {
            const dom = document.querySelector(`#chat .mes[mesid="${id}"] .mes_reasoning`);
            return String(dom?.textContent || message?.extra?.reasoning || '').replace(/\u200B/g, '').trim();
        },

        async run(messageId, { showOk = false } = {}) {
            const st = Core.getSettings();
            if (!st.enabled || !st.watchReasoning) return null;
            const preset = await Prompts.getOaiName();
            if (!SUPPORTED_PRESET.test(String(preset || ''))) return null;
            if (Number(messageId) === 0) {
                Alerts.clear('watch');
                return null;
            }
            const replies = this.replies(messageId);
            if (!replies.length) return null;

            const { prompts } = await Prompts.listLive();
            const stages = this.priorityStages(prompts);
            const problems = replies.flatMap(({ id, message }) =>
                this.inspectPlanning(this.reasoning(id, message), stages)
                    .map((problem) => ({ ...problem, messageId: id, msg: `ข้อความ #${id}: ${problem.msg}` })));
            if (!problems.length) {
                Alerts.clear('watch');
                if (showOk) Alerts.show({
                    key: 'watch-ok', level: 'ok', ttl: 4500, cooldown: 0,
                    title: 'ตรวจ Think ในแชทนี้แล้ว',
                    body: `ตรวจ reasoning block ของบอท ${replies.length} ข้อความ (ข้าม greeting #0) — สเตจสำคัญที่สุดมาครบ`,
                });
                return [];
            }
            Alerts.clear('watch-ok');
            Alerts.show({
                key: 'watch',
                level: 'warn',
                ttl: 0,
                cooldown: 0, // think broken → pop immediately, every time
                title: 'Think / planning ใน reasoning block ไม่ครบ',
                body: problems.map((p) => `· ${p.msg}`).join('\n'),
            });
            return problems;
        },
    };

    return { Alerts, PatchNotice, Doctor, Watch };
}
