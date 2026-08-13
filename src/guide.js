export function createGuide(app) {
    const Guide = {
        root: null,
        step: 0,
        activeSteps: [],
        previousSearch: null,
        starting: false,
        steps: [
            { find: 'Helios (All-rounder)', group: 'Format', title: 'สูตรเริ่มต้น: Helios', body: 'มือใหม่เปิด Engine เพียงหนึ่งตัวก่อน แนะนำ Helios สำหรับเล่นทั่วไป ครบทั้งตัวละคร โลก และความต่อเนื่อง ห้ามเปิดหลาย Engine พร้อมกันเพราะคำสั่งอาจชนกัน' },
            { find: 'Luna (Storyteller)', group: 'Format', title: 'Luna — เน้นการเล่าเรื่อง', body: 'เลือก Luna เมื่อต้องการอารมณ์ ตัวละคร และการเล่าเรื่องแบบนิยายเด่นกว่าเรื่องระบบโลก ใช้แทน Helios ไม่ใช่เปิดคู่กัน' },
            { find: 'Aether (World Expansion)', group: 'Format', title: 'Aether — เน้นโลกและ NPC', body: 'เลือก Aether สำหรับโลกกว้าง เหตุการณ์เบื้องหลัง ฝ่ายต่าง ๆ และ NPC จำนวนมาก เหมาะกับแคมเปญสำรวจหรือ sandbox' },
            { find: 'Aphrodite (Romance)', group: 'Format', title: 'Aphrodite — เน้นความสัมพันธ์', body: 'เลือก Aphrodite เมื่อแกนหลักคือโรแมนซ์ เคมี และพัฒนาการความสัมพันธ์ เป็น Engine หลักอีกตัว ไม่ใช่ Extension เสริม Helios' },
            { find: 'Pantheon (Debation)', group: 'Format', title: 'Pantheon — เน้นถกและตัดสินใจ', body: 'เลือก Pantheon สำหรับฉากอภิปราย หลายมุมมอง แผนซับซ้อน หรือการตัดสินใจที่ต้องชั่งน้ำหนักหลายฝ่าย' },
            { find: 'ภาษาไทย', group: 'Language', title: 'เลือกภาษาเพียงหนึ่งภาษา', body: 'เปิดภาษาไทยถ้าต้องการคำตอบไทย และปิด English/ภาษาอื่นไว้ อย่าเปิดหลายภาษาพร้อมกันเว้นแต่ตั้งใจให้สลับภาษา' },
            { find: 'บุคคลที่สาม (ค่า Default)', group: 'Extra Perspective', title: 'มุมมอง: เริ่มด้วยค่ามาตรฐาน', body: 'บุคคลที่สาม Default ใช้ง่ายและเสถียรที่สุด มุมมองพระเจ้าและบุคคลที่หนึ่งเป็นตัวเลือก ให้เปิดเพียงมุมมองเดียว' },
            { find: 'Dynamic (ยาว-สั้น อัตโนมัติ)', group: 'Length', title: 'ความยาว: Dynamic', body: 'Dynamic ให้ Omega ปรับความยาวตามฉาก เหมาะกับมือใหม่ที่สุด หากต้องการบังคับจังหวะค่อยเปลี่ยนเป็น Short, Medium, Long หรือ Extended อย่างใดอย่างหนึ่ง' },
            { find: 'L2 Balanced (50:50)', group: 'Prose Floor', title: 'บทพูดกับบรรยาย: L2 Balanced', body: 'L2 Balanced (50:50) เป็นค่าเริ่มต้นที่แนะนำ ถ้าอยากคุยเยอะค่อยเปลี่ยนเป็น L1 Yappers; ถ้าอยากได้สำนวนแบบนิยายค่อยเลือก L3 Novel' },
            { find: 'ใส่สไตล์การเขียน', group: 'Writing Styles', title: 'Writing Style เป็นตัวเลือก', body: 'ใส่แนวสำนวนที่ต้องการได้ เช่น กระชับ หม่น หรือแฟนตาซี หากยังไม่รู้จะตั้งอะไร ปล่อยค่าเดิมก่อนก็ได้' },
            { group: 'Extension', title: 'Extension: เปิดเท่าที่จำเป็น', body: 'ของเสริมอาจเพิ่ม token หรือรูปแบบพิเศษ เริ่มโดยปิดไว้ก่อน แล้วเปิดทีละตัวเมื่อรู้ว่าต้องการอะไร หากคำตอบเพี้ยนให้ปิดตัวล่าสุดก่อน' },
            { selector: '#oh-doctor', title: 'ก่อนเล่น: ตรวจ Reasoning', body: 'กดเช็ค Reasoning ให้ prefix/suffix ตรงกับโมเดล หลังตอบ Omega Helper จะเตือนถ้า planning ขาดสเตจ strongest pull ที่สำคัญที่สุด' },
            { selector: '#oh-content', title: 'ชุดแนะนำสำหรับมือใหม่', body: 'เริ่มด้วย Helios + ภาษาไทย + บุคคลที่สาม Default + Dynamic + L2 Balanced และปิด Extension ที่ยังไม่ใช้ เล่นให้คุ้นก่อนแล้วค่อยเปลี่ยนทีละอย่าง' },
        ],
        target(step) {
            const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
            const named = step.find ? [...this.root.querySelectorAll('[data-guide-name]')]
                .find((item) => normalize(item.dataset.guideName).includes(normalize(step.find))) : null;
            if (step.find) return named || null;
            const group = step.group ? [...this.root.querySelectorAll('[data-guide-group]')]
                .find((item) => normalize(item.dataset.guideGroup) === normalize(step.group)) : null;
            return group?.querySelector('.oh-group-head')
                || (step.selector ? this.root.querySelector(step.selector) : null);
        },
        async start(root) {
            if (this.starting) return;
            this.starting = true;
            this.close();
            try {
                if (app.Panel.root === root) {
                    await app.Panel.refresh();
                    root.querySelector('.oh-tab[data-tab="features"]:not(.active)')?.click?.();
                    this.previousSearch = app.Panel.search;
                    app.Panel.search = '';
                    const search = root.querySelector('#oh-search');
                    if (search) search.value = '';
                    app.Panel.render();
                }
                this.root = root;
                this.step = 0;
                const card = document.createElement('div');
                card.className = 'oh-guide';
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-modal', 'true');
                card.setAttribute('aria-label', 'คู่มือเริ่มต้น Omega');
                card.innerHTML = `
                    <div class="oh-guide-count"></div>
                    <b class="oh-guide-title"></b>
                    <p class="oh-guide-body"></p>
                    <div class="oh-guide-actions">
                        <button type="button" class="menu_button oh-guide-close">ข้าม</button>
                        <button type="button" class="menu_button oh-guide-prev">ก่อนหน้า</button>
                        <button type="button" class="menu_button oh-guide-next">ถัดไป</button>
                    </div>`;
                root.querySelector('#oh-panel')?.appendChild(card);
                root.querySelector('#oh-panel')?.classList.add('oh-guide-open');
                card.querySelector('.oh-guide-close')?.addEventListener('click', () => this.close());
                card.querySelector('.oh-guide-prev')?.addEventListener('click', () => this.move(-1));
                card.querySelector('.oh-guide-next')?.addEventListener('click', () => this.move(1));
                this.activeSteps = this.steps.filter((step) => this.target(step));
                this.show();
            } finally {
                this.starting = false;
            }
        },
        show() {
            const card = this.root?.querySelector('.oh-guide');
            if (!card) return;
            this.root.querySelector('.oh-guide-focus')?.classList.remove('oh-guide-focus');
            const step = this.activeSteps[this.step];
            if (!step) return this.close();
            const focus = this.target(step);
            focus?.closest?.('.oh-group')?.classList.remove('collapsed');
            card.classList.toggle('is-top', step.selector === '#oh-doctor');
            focus?.classList.add('oh-guide-focus');
            focus?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            card.querySelector('.oh-guide-count').textContent = `${this.step + 1} / ${this.activeSteps.length}`;
            card.querySelector('.oh-guide-title').textContent = step.title;
            card.querySelector('.oh-guide-body').textContent = step.body;
            card.querySelector('.oh-guide-prev').disabled = this.step === 0;
            const next = card.querySelector('.oh-guide-next');
            next.textContent = this.step === this.activeSteps.length - 1 ? 'เสร็จ' : 'ถัดไป';
            next.focus?.();
        },
        move(delta) {
            if (this.step + delta >= this.activeSteps.length) return this.close();
            this.step = Math.max(0, this.step + delta);
            this.show();
        },
        close() {
            const root = this.root;
            root?.querySelector('.oh-guide-focus')?.classList.remove('oh-guide-focus');
            root?.querySelector('.oh-guide')?.remove();
            root?.querySelector('#oh-panel')?.classList.remove('oh-guide-open');
            if (root && this.previousSearch !== null && app.Panel.root === root) {
                app.Panel.search = this.previousSearch;
                const search = root.querySelector('#oh-search');
                if (search) search.value = this.previousSearch;
                app.Panel.render();
            }
            this.previousSearch = null;
            this.root = null;
            this.activeSteps = [];
            root?.querySelector('#oh-guide')?.focus?.();
        },
    };

    return { Guide };
}

