import { LOG, SUPPORTED_PRESET, VERSION } from './config.js';

export function createPanel(app) {
    const { Core, Prompts, RequiredPrompts, Engine, Features, Profiles, Doctor, Guide } = app;

    const Panel = {
        isOpen: false,
        root: null,
        search: '',
        cache: null,
        _onKey: null,
        _searchTimer: null,
        _opener: null,
        _refreshPromise: null,
        _refreshQueued: false,

        async show() {
            if (this.isOpen) {
                await this.refresh();
                return;
            }
            this._opener = document.activeElement || null;
            this.isOpen = true;
            // Search is session-only. A stale query made complete preset groups look incomplete.
            this.search = '';
            this.mount();
            await this.refresh();
        },
        close() {
            if (!this.isOpen) return;
            Guide.close();
            this.isOpen = false;
            if (this._searchTimer) {
                clearTimeout(this._searchTimer);
                this._searchTimer = null;
            }
            if (this._onKey) {
                document.removeEventListener('keydown', this._onKey);
                this._onKey = null;
            }
            this.root?.remove();
            this.root = null;
            document.body.classList.remove('oh-no-scroll', 'oh-open');
            const opener = this._opener;
            this._opener = null;
            setTimeout(() => opener?.isConnected && opener.focus?.(), 0);
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
                        <button type="button" class="menu_button menu_button_icon" id="oh-guide" title="คู่มือเริ่มใช้ Omega JB" aria-label="เปิดคู่มือเริ่มใช้ Omega JB">
                            <i class="fa-solid fa-book-open"></i>
                        </button>
                        <button type="button" class="menu_button menu_button_icon" id="oh-close" title="ปิด" aria-label="ปิด">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    <div id="oh-panel-body">
                        <div class="oh-tabs" role="tablist">
                            <button type="button" class="oh-tab active" data-tab="features" role="tab" aria-selected="true" aria-controls="oh-content" title="Prompt ตามหมวดใน preset">Prompt</button>
                            <button type="button" class="oh-tab" data-tab="regex" role="tab" aria-selected="false" aria-controls="oh-content" tabindex="-1" title="Regex ของ preset/global/scoped">Regex</button>
                        </div>
                        <div class="oh-toolbar">
                            <label class="oh-search-box" for="oh-search">
                                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                                <input type="search" id="oh-search" class="text_pole" placeholder="ค้นหาฟีเจอร์หรือ Regex..." enterkeyhint="search" autocomplete="off" />
                            </label>
                            <select id="oh-profile-select" class="text_pole" title="โปรไฟล์" aria-label="โปรไฟล์"></select>
                        </div>
                        <div class="oh-toolbar oh-profile-actions">
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-apply" title="ใช้โปรไฟล์"><i class="fa-solid fa-check"></i><span>ใช้</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-save" title="เซฟชุด"><i class="fa-solid fa-floppy-disk"></i><span>เซฟชุด</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-overwrite" title="ทับ"><i class="fa-solid fa-file-export"></i><span>ทับ</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-undo" title="ย้อนการใช้โปรไฟล์ล่าสุด" disabled><i class="fa-solid fa-rotate-left"></i><span>ย้อนกลับ</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-del" title="ลบ" aria-label="ลบโปรไฟล์"><i class="fa-solid fa-trash"></i></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-export" title="ส่งออกทุกโปรไฟล์"><i class="fa-solid fa-download"></i><span>ส่งออกทั้งหมด</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-profile-import" title="นำเข้าโปรไฟล์"><i class="fa-solid fa-upload"></i><span>นำเข้า</span></button>
                            <button type="button" class="menu_button menu_button_icon" id="oh-refresh" title="รีเฟรช" aria-label="รีเฟรช"><i class="fa-solid fa-rotate"></i></button>
                        </div>
                        <p class="oh-status" id="oh-status">กำลังโหลด...</p>
                        <p class="oh-status oh-doctor-line" id="oh-doctor-line" hidden></p>
                        <div id="oh-content" role="tabpanel"></div>
                    </div>
                    <div id="oh-panel-footer">
                        <button type="button" class="menu_button menu_button_icon" id="oh-allow-preset"><i class="fa-solid fa-unlock"></i><span>Allow preset regex</span></button>
                        <button type="button" class="menu_button menu_button_icon" id="oh-doctor" title="เช็ค Reasoning Formatting กับโมเดลปัจจุบัน"><i class="fa-solid fa-stethoscope"></i><span>เช็ค Reasoning</span></button>
                        <button type="button" class="menu_button menu_button_icon" id="oh-open-pm" title="เลื่อนไป Prompt Manager"><i class="fa-solid fa-list-check"></i><span>Prompt Manager</span></button>
                        <button type="button" class="menu_button menu_button_icon" id="oh-open-native"><i class="fa-solid fa-code"></i><span>Regex เต็ม</span></button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.body.classList.add('oh-no-scroll', 'oh-open');
            this.root = overlay;

            overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
            overlay.querySelector('#oh-close')?.addEventListener('click', () => this.close());
            overlay.querySelector('#oh-guide')?.addEventListener('click', () => void Guide.start(overlay));

            const st = Core.getSettings();
            const tabs = [...overlay.querySelectorAll('.oh-tab')];
            const activateTab = (tab, focus = false) => {
                tabs.forEach((item) => {
                    const active = item === tab;
                    item.classList.toggle('active', active);
                    item.setAttribute('aria-selected', String(active));
                    item.tabIndex = active ? 0 : -1;
                });
                const s = Core.getSettings();
                s.activeTab = tab.dataset.tab;
                Core.saveSettings();
                this.render();
                if (focus) tab.focus();
            };
            tabs.forEach((tab) => {
                const active = tab.dataset.tab === (st.activeTab || 'features');
                tab.classList.toggle('active', active);
                tab.setAttribute('aria-selected', String(active));
                tab.tabIndex = active ? 0 : -1;
                tab.addEventListener('click', () => activateTab(tab));
                tab.addEventListener('keydown', (event) => {
                    const index = tabs.indexOf(tab);
                    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
                        : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
                            : event.key === 'Home' ? tabs[0]
                                : event.key === 'End' ? tabs[tabs.length - 1] : null;
                    if (!next) return;
                    event.preventDefault();
                    activateTab(next, true);
                });
            });
            if (!tabs.some((tab) => tab.classList.contains('active')) && tabs[0]) {
                activateTab(tabs[0]);
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
                        this.render();
                    }, 140);
                });
            }

            const syncUndoButton = () => {
                const button = overlay.querySelector('#oh-profile-undo');
                if (button) button.disabled = !Profiles.undoProfile;
            };
            syncUndoButton();
            overlay.querySelector('#oh-refresh')?.addEventListener('click', () => this.refresh());
            overlay.querySelector('#oh-profile-apply')?.addEventListener('click', async () => {
                const id = overlay.querySelector('#oh-profile-select')?.value;
                if (!id) return Core.toast('info', 'เลือกโปรไฟล์ก่อน');
                try {
                    const preview = await Profiles.preview(id);
                    const promptMissing = preview.report.prompt.total - preview.report.prompt.matched;
                    const regexMissing = preview.report.regex.total - preview.report.regex.matched;
                    const lines = [
                        `ใช้โปรไฟล์ “${preview.profile.name}” ?`,
                        `Prompt: เปลี่ยน ${preview.report.prompt.changed} · พบ ${preview.report.prompt.matched}/${preview.report.prompt.total}${preview.report.prompt.reordered ? ' · จัดลำดับใหม่' : ''}`,
                        `Regex: เปลี่ยน ${preview.report.regex.changed} · พบ ${preview.report.regex.matched}/${preview.report.regex.total}`,
                    ];
                    if (promptMissing + regexMissing > 0) lines.push(`หาไม่พบ ${promptMissing + regexMissing} รายการ`);
                    if (preview.presetMismatch) {
                        lines.push(`⚠ โปรไฟล์จาก “${preview.savedPreset}” แต่ตอนนี้ใช้ “${preview.currentPreset}”`);
                    }
                    if (!(window.confirm?.(lines.join('\n')) ?? true)) return;
                    const { profile, report } = await Profiles.apply(id);
                    const matched = report.prompt.matched + report.regex.matched;
                    const total = report.prompt.total + report.regex.total;
                    const missing = total - matched;
                    syncUndoButton();
                    Core.toast(missing ? 'warning' : 'success',
                        `ใช้: ${profile.name} · ตรง ${matched}/${total}${missing ? ` · ไม่พบ ${missing}` : ''}`);
                    await this.refresh();
                } catch (err) {
                    syncUndoButton();
                    Core.toast('error', err?.message || String(err));
                }
            });
            overlay.querySelector('#oh-profile-undo')?.addEventListener('click', async () => {
                try {
                    await Profiles.undoLast();
                    syncUndoButton();
                    Core.toast('success', 'ย้อนกลับไปก่อนใช้โปรไฟล์แล้ว');
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
            overlay.querySelector('#oh-profile-export')?.addEventListener('click', () => {
                try {
                    const data = Profiles.exportData();
                    if (!data.profiles.length) return Core.toast('info', 'ยังไม่มีโปรไฟล์ให้ส่งออก');
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `omega-helper-profiles-${new Date().toISOString().slice(0, 10)}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                } catch (err) { Core.toast('error', err?.message || String(err)); }
            });
            overlay.querySelector('#oh-profile-import')?.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/json,.json';
                input.addEventListener('change', async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) return Core.toast('error', 'ไฟล์ใหญ่เกิน 2 MB');
                    try {
                        const imported = Profiles.importData(JSON.parse(await file.text()));
                        this.fillProfiles();
                        Core.toast('success', `นำเข้า ${imported.length} โปรไฟล์`);
                    } catch (err) { Core.toast('error', err?.message || String(err)); }
                }, { once: true });
                input.click();
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

            this._onKey = (e) => {
                if (e.key === 'Escape' && Guide.root) {
                    e.preventDefault();
                    Guide.close();
                    return;
                }
                if (e.key === 'Escape' && this.isOpen && Core.getSettings().closeOnEscape) {
                    e.preventDefault();
                    this.close();
                    return;
                }
                if (e.key === 'Tab' && this.isOpen) {
                    const scope = Guide.root ? overlay.querySelector('.oh-guide') : overlay;
                    const focusable = [...scope.querySelectorAll(
                        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    )].filter((item) => !item.hidden && item.offsetParent !== null);
                    if (!focusable.length) return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    if (e.shiftKey && document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    } else if (!e.shiftKey && document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            };
            document.addEventListener('keydown', this._onKey);
            this.fillProfiles();
            setTimeout(() => searchEl?.focus(), 0);
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

        refresh() {
            if (this._refreshPromise) {
                this._refreshQueued = true;
                return this._refreshPromise;
            }
            this._refreshPromise = (async () => {
                do {
                    this._refreshQueued = false;
                    await this.refreshNow();
                } while (this._refreshQueued && this.root);
            })().finally(() => {
                this._refreshPromise = null;
                this._refreshQueued = false;
            });
            return this._refreshPromise;
        },

        async refreshNow() {
            const root = this.root;
            if (!root) return;
            const status = root.querySelector('#oh-status');
            try {
                if (status) {
                    status.className = 'oh-status';
                    status.textContent = 'กำลังโหลด Chat Completion + regex...';
                }
                const [resolved, allow, oai] = await Promise.all([
                    Features.resolve(),
                    Engine.isPresetAllowed(),
                    Prompts.getOaiName(),
                ]);
                if (this.root !== root) return;
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
                const meta = root.querySelector('#oh-header-meta');
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
            const dependency = Features.needsClickableInputs([pack])
                ? ' · <span class="oh-badge prompt">ต้องใช้ st-clickable-inputs</span>' : '';
            return `<span class="oh-badge prompt">Prompt</span> · ${order}${dependency}`;
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
                section.dataset.guideGroup = g.meta.title;
                const bodyId = `oh-group-${Core.uid()}`;

                const head = document.createElement('div');
                head.className = 'oh-group-head';
                head.innerHTML = `
                    <button type="button" class="oh-group-title" aria-expanded="${!collapsed}" aria-controls="${bodyId}">
                        <b><i class="fa-solid ${Core.escape(g.meta.icon)}"></i> ${Core.escape(g.meta.title)}</b>
                        <small>${onCount}/${items.length} เปิด · ตามลำดับใน preset</small>
                    </button>
                    <div class="oh-group-actions">
                        <button type="button" class="menu_button menu_button_icon oh-g-on" title="เปิดทั้งกลุ่ม" aria-label="เปิดทั้งกลุ่ม"><i class="fa-solid fa-toggle-on"></i></button>
                        <button type="button" class="menu_button menu_button_icon oh-g-off" title="ปิดทั้งกลุ่ม" aria-label="ปิดทั้งกลุ่ม"><i class="fa-solid fa-toggle-off"></i></button>
                        <button type="button" class="menu_button menu_button_icon oh-g-fold" aria-label="${collapsed ? 'ขยายกลุ่ม' : 'ยุบกลุ่ม'}" aria-expanded="${!collapsed}" aria-controls="${bodyId}"><i class="fa-solid fa-chevron-${collapsed ? 'down' : 'up'}"></i></button>
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
                        this.renderFeatures(host);
                        this.updateFeatureMeta();
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
                    for (const control of head.querySelectorAll('.oh-group-title, .oh-g-fold')) {
                        control.setAttribute('aria-expanded', String(!next));
                    }
                    head.querySelector('.oh-g-fold')?.setAttribute('aria-label', next ? 'ขยายกลุ่ม' : 'ยุบกลุ่ม');
                };
                head.querySelector('.oh-g-fold')?.addEventListener('click', (e) => { e.stopPropagation(); fold(); });
                head.querySelector('.oh-group-title')?.addEventListener('click', fold);

                const body = document.createElement('div');
                body.className = 'oh-group-body';
                body.id = bodyId;

                for (const pack of items) {
                    shown += 1;
                    const row = document.createElement('div');
                    row.className = `oh-row is-${pack.state}`;
                    row.dataset.guideName = [pack.def.title, ...pack.prompts.map((prompt) => prompt.name)].join(' ');

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

    return { Panel };
}
