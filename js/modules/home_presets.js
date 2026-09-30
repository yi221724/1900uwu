/* uwu-1900 主页预设：在 main.js 前加载，不修改聊天数据。 */
(() => {
    'use strict';
    const FORMAT = 'uwu-1900-home-presets';
    const KEYS = ['homePresets', 'activeHomePresetId', 'homePresetUndo'];
    const HOME_KEYS = ['homeLayoutPages', 'homeLayoutOrder', 'addedWidgets',
        'wallpaper', 'homeScreenMode', 'customIcons', 'homeSignature',
        'insWidgetSettings', 'homeWidgetSettings'];
    KEYS.forEach(key => { if (!globalSettingKeys.includes(key)) globalSettingKeys.push(key); });
    const clone = value => JSON.parse(JSON.stringify(value));
    const uid = () => 'hp-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const toast = message => typeof showToast === 'function' ? showToast(message) : alert(message);
    let busy = false;
    function ensure() {
        if (!Array.isArray(db.homePresets)) db.homePresets = [];
        if (db.activeHomePresetId === undefined) db.activeHomePresetId = null;
        if (db.homePresetUndo === undefined) db.homePresetUndo = null;
    }
    function assert(ok, message) { if (!ok) throw new Error(message); }
    function checkTree(value, depth = 0) {
        assert(depth < 50, '文件嵌套过深');
        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, child]) => {
                assert(!['__proto__', 'prototype', 'constructor'].includes(key), '文件包含不支持的字段');
                checkTree(child, depth + 1);
            });
        }
    }
    function validateSnapshot(source) {
        assert(object(source), '主页数据格式不正确');
        checkTree(source);
        assert(Array.isArray(source.homeLayoutPages) && source.homeLayoutPages.length > 0 && source.homeLayoutPages.length <= 100, '主页分页数据不正确');
        const pages = source.homeLayoutPages;
        assert(pages.every(page => Array.isArray(page) && page.length <= 1000 && page.every(id => typeof id === 'string' && /^[\w-]+$/.test(id))), '图标位置数据不正确');
        const ids = pages.flat();
        assert(new Set(ids).size === ids.length, '同一图标或小组件不能重复出现');
        assert(Array.isArray(source.addedWidgets) && Array.isArray(source.widgetTemplates), '小组件内容缺失');
        assert(source.addedWidgets.length <= 1000 && source.widgetTemplates.length <= 1000, '小组件数量过多');
        const templateIds = new Set();
        source.widgetTemplates.forEach(template => {
            assert(object(template) && typeof template.id === 'string' && /^[\w-]+$/.test(template.id), '小组件模板标识不正确');
            assert(!templateIds.has(template.id), '小组件模板标识重复');
            templateIds.add(template.id);
            assert(['1x1', '2x2', '4x2', '4x4', '2x4'].includes(template.size), '小组件尺寸不支持');
            assert(typeof template.html === 'string' && typeof template.css === 'string', '小组件 HTML 或 CSS 缺失');
            assert(template.js === undefined || typeof template.js === 'string', '小组件 JS 格式不正确');
            assert(object(template.defaultVars), '小组件默认内容不正确');
        });
        const widgetIds = new Set();
        source.addedWidgets.forEach(widget => {
            assert(object(widget) && typeof widget.id === 'string' && /^[\w-]+$/.test(widget.id), '小组件实例标识不正确');
            assert(!widgetIds.has(widget.id), '小组件实例重复');
            widgetIds.add(widget.id);
            assert(templateIds.has(widget.templateId) && object(widget.vars), '小组件模板或内容缺失');
            assert(ids.includes(widget.id), '小组件没有对应的主页位置');
        });
        const apps = new Set(['app-chat', 'app-api', 'app-wallpaper', 'app-worldbook', 'app-customize', 'app-tutorial', 'app-console', 'app-widget-market', 'app-reader', 'app-placeholder']);
        assert(ids.every(id => apps.has(id) || widgetIds.has(id)), '文件包含当前版本不支持的主页项目');
        assert(typeof source.wallpaper === 'string' && ['day', 'night'].includes(source.homeScreenMode), '壁纸或日夜模式不正确');
        assert(object(source.customIcons) && Object.values(source.customIcons).every(value => typeof value === 'string'), '图标图片数据不正确');
        assert(typeof source.homeSignature === 'string' && object(source.insWidgetSettings) && object(source.homeWidgetSettings), '主页文字或内置组件数据不正确');
        const result = {};
        HOME_KEYS.forEach(key => { if (source[key] !== undefined) result[key] = clone(source[key]); });
        result.homeLayoutOrder = ids.slice();
        result.widgetTemplates = clone(source.widgetTemplates);
        return result;
    }
    function capture() {
        assert(document.getElementById('home-screen-swiper'), '主页还在加载，请稍后再试');
        const pages = clone(db.homeLayoutPages || [db.homeLayoutOrder || []]);
        const visible = new Set(pages.flat());
        const widgets = clone((db.addedWidgets || []).filter(widget => visible.has(widget.id)));
        const used = new Set(widgets.map(widget => widget.templateId));
        const snapshot = {};
        HOME_KEYS.forEach(key => { if (db[key] !== undefined) snapshot[key] = clone(db[key]); });
        snapshot.homeLayoutPages = pages;
        snapshot.homeLayoutOrder = pages.flat();
        snapshot.addedWidgets = widgets;
        snapshot.widgetTemplates = clone((db.widgetTemplates || []).filter(template => used.has(template.id)));
        snapshot.customIcons = snapshot.customIcons || {};
        snapshot.insWidgetSettings = snapshot.insWidgetSettings || {};
        snapshot.homeWidgetSettings = snapshot.homeWidgetSettings || {};
        snapshot.homeSignature = snapshot.homeSignature || '';
        return validateSnapshot(snapshot);
    }
    // 只写相关设置；保存失败时不改内存中的数据，也不写聊天表。
    async function commit(patch) {
        assert(typeof dexieDB !== 'undefined' && dexieDB, '数据库尚未加载');
        await dexieDB.transaction('rw', dexieDB.globalSettings, async () => {
            for (const [key, value] of Object.entries(patch)) {
                await dexieDB.globalSettings.put({ key, value: clone(value) });
            }
        });
        Object.assign(db, patch);
    }
    function mergeTemplates(snapshot) {
        const result = clone(db.widgetTemplates || []);
        const remap = new Map();
        for (const saved of snapshot.widgetTemplates) {
            const existing = result.find(template => template.id === saved.id);
            if (!existing) { result.push(clone(saved)); continue; }
            if (JSON.stringify(existing) === JSON.stringify(saved)) continue;
            const restored = result.find(candidate => {
                const normalized = clone(candidate);
                ['html', 'css', 'js'].forEach(key => {
                    if (typeof normalized[key] === 'string') normalized[key] = normalized[key].split(candidate.id).join(saved.id);
                });
                normalized.id = saved.id;
                return JSON.stringify(normalized) === JSON.stringify(saved);
            });
            if (restored) { remap.set(saved.id, restored.id); continue; }
            // 同名但不同内容：保留组件库原模板，并给预设中的版本分配新 ID。
            const copy = clone(saved);
            const newId = uid();
            remap.set(saved.id, newId);
            ['html', 'css', 'js'].forEach(key => {
                if (typeof copy[key] === 'string') copy[key] = copy[key].split(saved.id).join(newId);
            });
            copy.id = newId;
            result.push(copy);
        }
        snapshot.addedWidgets.forEach(widget => {
            if (remap.has(widget.templateId)) widget.templateId = remap.get(widget.templateId);
        });
        return result;
    }
    function refreshHome() {
        document.querySelectorAll('style[id^="custom-widget-style-"]').forEach(style => style.remove());
        const used = new Set((db.addedWidgets || []).map(widget => widget.templateId));
        (db.widgetTemplates || []).filter(template => used.has(template.id)).forEach(template => {
            const style = document.createElement('style');
            style.id = 'custom-widget-style-' + template.id;
            style.textContent = template.css.replace(/{{id}}/g, template.id);
            document.head.appendChild(style);
        });
        if (typeof exitHomeEditMode === 'function') exitHomeEditMode();
        setupHomeScreen();
        if (typeof renderCustomizeForm === 'function') renderCustomizeForm();
        const preview = document.getElementById('wallpaper-preview');
        if (preview) preview.style.backgroundImage = 'url(' + JSON.stringify(db.wallpaper) + ')';
    }
    async function apply(preset, edit = false) {
        const previous = { data: capture(), activeId: db.activeHomePresetId || null };
        const next = validateSnapshot(preset.data);
        const templates = mergeTemplates(next);
        delete next.widgetTemplates;
        await commit({ ...next, widgetTemplates: templates, activeHomePresetId: preset.id, homePresetUndo: previous });
        refreshHome();
        close();
        switchScreen('home-screen');
        if (edit && typeof enterHomeEditMode === 'function') enterHomeEditMode();
        toast(edit ? '调整主页后回到预设管理，点「覆盖保存」' : '主页预设已应用');
    }
    function download(presets, name) {
        const payload = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
            presets: presets.map(preset => ({ name: preset.name, data: validateSnapshot(preset.data) })) };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name.replace(/[\\/:*?"<>|]/g, '-') + '.json';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    function parseImport(text) {
        const payload = JSON.parse(text);
        checkTree(payload);
        assert(object(payload) && payload.format === FORMAT && payload.version === 1, '请选择本功能导出的主页预设 JSON，不能导入整机备份或单个组件文件');
        assert(Array.isArray(payload.presets) && payload.presets.length > 0 && payload.presets.length <= 200, '预设数量不正确');
        return payload.presets.map(preset => {
            assert(object(preset) && typeof preset.name === 'string' && preset.name.trim() && preset.name.length <= 100, '预设名称不正确');
            return { id: uid(), name: preset.name.trim(), updatedAt: Date.now(), data: validateSnapshot(preset.data) };
        });
    }
    const button = (label, action, id) => {
        const el = document.createElement('button');
        el.type = 'button'; el.textContent = label; el.dataset.hpAction = action;
        if (id) el.dataset.hpId = id;
        return el;
    };
    function render() {
        ensure();
        const list = document.getElementById('hp-list');
        list.replaceChildren();
        if (!db.homePresets.length) {
            const empty = document.createElement('p'); empty.textContent = '还没有预设，先保存当前主页。'; list.appendChild(empty);
        }
        db.homePresets.forEach(preset => {
            const row = document.createElement('div'); row.className = 'hp-row';
            const title = document.createElement('strong');
            title.textContent = preset.name + (db.activeHomePresetId === preset.id ? ' · 当前方案' : '');
            row.appendChild(title);
            const note = document.createElement('p');
            note.textContent = `${preset.data.homeLayoutPages.length} 页 · ${preset.data.addedWidgets.length} 个小组件`;
            row.appendChild(note);
            const controls = document.createElement('div'); controls.className = 'hp-buttons';
            [['应用', 'apply'], ['修改布局', 'edit'], ['覆盖保存', 'overwrite'], ['重命名', 'rename'], ['复制', 'copy'], ['导出', 'export'], ['删除', 'delete']].forEach(([label, action]) => controls.appendChild(button(label, action, preset.id)));
            row.appendChild(controls); list.appendChild(row);
        });
        document.querySelector('#hp-dialog [data-hp-action="undo"]').disabled = !db.homePresetUndo;
    }
    function close() { document.getElementById('hp-dialog').hidden = true; }
    async function handle(action, id) {
        ensure();
        const preset = db.homePresets.find(item => item.id === id);
        if (action === 'close') return close();
        if (action === 'import') return document.getElementById('hp-import').click();
        if (action === 'save') {
            assert(db.homePresets.length < 200, '最多保存 200 套预设，请先导出并删除不需要的预设');
            const name = prompt('给当前主页预设起个名字：', '我的主页');
            if (!name || !name.trim()) return;
            assert(name.trim().length <= 100, '名称最多 100 个字');
            const record = { id: uid(), name: name.trim(), updatedAt: Date.now(), data: capture() };
            await commit({ homePresets: [...db.homePresets, record], activeHomePresetId: record.id });
            toast('当前主页已保存');
        } else if (action === 'export-all') {
            assert(db.homePresets.length, '还没有可导出的预设');
            download(db.homePresets, '全部主页预设');
        } else if (action === 'undo') {
            assert(db.homePresetUndo, '没有可恢复的主页');
            const before = clone(db.homePresetUndo);
            await apply({ id: before.activeId, data: before.data });
            toast('已恢复上一次切换前的主页');
        } else {
            assert(preset, '预设不存在，请重新打开管理');
            if (action === 'apply' || action === 'edit') return apply(preset, action === 'edit');
            if (action === 'export') return download([preset], preset.name);
            if (action === 'overwrite') {
                if (!confirm('把当前主页保存到「' + preset.name + '」？将替换这套预设原来的布局和内容。')) return;
                const updated = { ...preset, data: capture(), updatedAt: Date.now() };
                await commit({ homePresets: db.homePresets.map(item => item.id === id ? updated : item), activeHomePresetId: id });
                toast('预设已更新');
            } else if (action === 'rename') {
                const name = prompt('预设的新名称：', preset.name);
                if (!name || !name.trim()) return;
                assert(name.trim().length <= 100, '名称最多 100 个字');
                await commit({ homePresets: db.homePresets.map(item => item.id === id ? { ...item, name: name.trim() } : item) });
            } else if (action === 'copy') {
                assert(db.homePresets.length < 200, '最多保存 200 套预设');
                await commit({ homePresets: [...db.homePresets, { ...clone(preset), id: uid(), name: preset.name + ' 副本', updatedAt: Date.now() }] });
            } else if (action === 'delete') {
                if (!confirm('删除保存的预设「' + preset.name + '」？当前主页和组件库会保留。')) return;
                await commit({ homePresets: db.homePresets.filter(item => item.id !== id), activeHomePresetId: db.activeHomePresetId === id ? null : db.activeHomePresetId });
                toast('预设已删除');
            }
        }
        render();
    }
    async function run(task) {
        if (busy) return;
        busy = true;
        const dialog = document.getElementById('hp-dialog');
        dialog.setAttribute('aria-busy', 'true');
        try { await task(); } catch (error) { console.error('主页预设：', error); toast(error.message || '操作失败，请重试'); }
        finally { busy = false; dialog.removeAttribute('aria-busy'); }
    }
    function mount() {
        if (document.getElementById('hp-entry')) return;
        const form = document.getElementById('customize-form');
        if (!form) return;
        const style = document.createElement('style');
        style.textContent = `
        #hp-entry {width:100%;margin:0 0 16px;padding:15px;border:1px solid #dedee2;border-radius:12px;background:#fff;color:#333;text-align:left;font:inherit;cursor:pointer}
        #hp-dialog[hidden] {display:none!important}
        #hp-dialog {position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;color:#333}
        #hp-dialog .hp-panel {width:100%;max-width:480px;max-height:85vh;max-height:85dvh;overflow:auto;background:#fff;border-radius:18px;padding:18px;box-sizing:border-box}
        #hp-dialog h3 {margin:0 0 10px;font-size:18px}
        #hp-dialog p {font-size:12px;line-height:1.7;color:#777;margin:8px 0}
        #hp-dialog .hp-buttons {display:flex;flex-wrap:wrap;gap:8px}
        #hp-dialog button {font:inherit;font-size:12px;border:1px solid #ddd;border-radius:8px;padding:9px 11px;background:#f7f7f8;color:#333;cursor:pointer}
        #hp-dialog button:disabled {opacity:.4;cursor:default}
        #hp-dialog [data-hp-action="apply"],#hp-dialog [data-hp-action="save"] {background:#4c4d55;color:#fff;border-color:#4c4d55}
        #hp-dialog .hp-row {border-top:1px solid #eee;padding:15px 0}
        #hp-dialog strong {font-size:14px;overflow-wrap:anywhere}
        #hp-dialog[aria-busy="true"] button {pointer-events:none;opacity:.5}
        #hp-list {margin-top:16px}`;
        document.head.appendChild(style);
        const entry = document.createElement('button');
        entry.id = 'hp-entry'; entry.type = 'button'; entry.textContent = '主页预设 › 保存、切换、导入与导出';
        form.before(entry);
        const dialog = document.createElement('div'); dialog.id = 'hp-dialog'; dialog.hidden = true;
        dialog.innerHTML = '<section class="hp-panel" role="dialog" aria-modal="true" aria-labelledby="hp-title"><h3 id="hp-title">主页预设</h3><p>保存图标、分页、壁纸和小组件的代码、图片与文字。修改布局后点对应预设的「覆盖保存」。</p><div class="hp-buttons"></div><div id="hp-list"></div><input id="hp-import" type="file" accept=".json,application/json" hidden></section>';
        const controls = dialog.querySelector('.hp-buttons');
        [['保存当前主页', 'save'], ['导入', 'import'], ['导出全部', 'export-all'], ['恢复切换前主页', 'undo'], ['关闭', 'close']].forEach(([label, action]) => controls.appendChild(button(label, action)));
        document.body.appendChild(dialog);
        entry.addEventListener('click', () => { render(); dialog.hidden = false; });
        dialog.addEventListener('click', event => {
            if (event.target === dialog && !busy) return close();
            const control = event.target.closest('button[data-hp-action]');
            if (control) run(() => handle(control.dataset.hpAction, control.dataset.hpId));
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) close(); });
        document.getElementById('hp-import').addEventListener('change', event => run(async () => {
            const file = event.target.files[0];
            event.target.value = '';
            if (!file) return;
            assert(file.size <= 100 * 1024 * 1024, '文件超过 100MB，请分别导入');
            const imported = parseImport(await file.text());
            ensure();
            assert(db.homePresets.length + imported.length <= 200, '导入后超过 200 套预设，请先整理现有预设');
            await commit({ homePresets: [...db.homePresets, ...imported] });
            render(); toast(`已导入 ${imported.length} 套预设，点击「应用」切换`);
        }));
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
