import { EXT_ID } from './config.js';

export function createUi({ Core, Alerts, Doctor, Watch, Panel }) {
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
                                    <span>ตรวจเนื้อหาใน thinking block ทุกคำตอบ + ทั้งแชทตอนเปิด (ข้าม greeting #0)</span>
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
                                    ตัวตรวจ think อ่าน <code>.mes_reasoning</code> ที่อยู่ใต้หัวข้อ Thought for some time โดยตรง แยกจาก Reasoning Formatting<br>
                                    ทำงานกับ preset Omega / 5EX เท่านั้น<br>
                                    Prefix / Suffix = <code>&lt;planning&gt;</code> / <code>&lt;/planning&gt;</code> ทั้งสองแบบ<br>
                                    gemini 3.5 flash / 3.1 pro ลงมา → Start Reply With = <code>&lt;planning&gt;</code> + ติ๊ก Show reply prefix<br>
                                    gemini 3.5 flash-lite / 3.6 ขึ้นไป → Start Reply With ว่าง + เอาติ๊กออก
                                </small>
                                <div class="flex-container flexGap10 marginTop10">
                                    <button type="button" id="oh-check-think-now" class="menu_button menu_button_icon"><i class="fa-solid fa-brain"></i><span>เช็ค think ในแชท</span></button>
                                    <button type="button" id="oh-check-now" class="menu_button menu_button_icon"><i class="fa-solid fa-stethoscope"></i><span>เช็ค Formatting</span></button>
                                </div>
                            </div>
                        </div>

                        <div class="flex-container flexGap10 marginTop10">
                            <button type="button" id="oh-open-now" class="menu_button menu_button_icon"><i class="fa-solid fa-sliders"></i><span>เปิดแผง</span></button>
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
            wrap.querySelector('#oh-check-think-now')?.addEventListener('click', () => Watch.run(undefined, { showOk: true }));
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
            btn.setAttribute('role', 'button');
            btn.title = 'Omega Helper';
            btn.innerHTML = `
                <div class="fa-fw fa-solid fa-bolt extensionsMenuExtensionButton"></div>
                <span>Omega Helper</span>
            `;
            btn.addEventListener('click', () => Panel.show());
            btn.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    Panel.show();
                }
            });
            menu.appendChild(btn);
        },

        syncWandButton(settings) {
            this.injectWandButton();
        },
    };

    return { UI };
}

