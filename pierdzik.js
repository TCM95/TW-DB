// ==UserScript==
// @name         TW-DB (LEVEL 4 ENGINE - UNIVERSAL RENDER) - FIXED
// @author       Gal Anonim / Improved
// @namespace    https://viayoo.com/
// @match        *://*.plemiona.pl/game.php?*
// @match        https://twdatabase.online/*
// @require      https://raw.githubusercontent.com/TCM95/TW-DB/main/analiza.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const MASTER_CONFIG = 'https://raw.githubusercontent.com/TCM95/TW-DB/refs/heads/main/confing.json';
    const APP_NAME = 'TWDB_ENGINE';
    const ANALYSIS_KEY = `${APP_NAME}:analysis`;

    const App = {
        modules: [],
        cache: {},
        state: {
            url: location.href,
            village: new URLSearchParams(location.search).get('village')
        }
    };

    const isPlemiona = () => /(^|\.)plemiona\.pl$/i.test(location.hostname);
    const isTWDatabase = () => /(^|\.)twdatabase\.online$/i.test(location.hostname);

    const fetchJson = (url) => {
        if (App.cache[url]) return Promise.resolve(App.cache[url]);
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url + '?t=' + Date.now(),
                onload: (r) => {
                    try {
                        const data = JSON.parse(r.responseText);
                        App.cache[url] = data;
                        resolve(data);
                    } catch (e) {
                        console.warn('[TW-DB] JSON parse failed:', url, e);
                        resolve(null);
                    }
                },
                onerror: () => resolve(null)
            });
        });
    };

    const normalize = (d) => Array.isArray(d) ? d : [d];

    function createModule(data) {
        return {
            data,
            mounted: false,
            init() {
                if (!isPlemiona() || this.mounted) return;
                this.render();
                this.mounted = true;
            },
            destroy() {
                if (!isPlemiona()) return;
                const key = `tcm-mod-${String(this.data.page || '').replace(/\W/g, '')}`;
                document.querySelectorAll(`[data-tcm="${key}"]`).forEach((el) => el.remove());
                this.mounted = false;
            },
            render() {
                renderUniversal(normalize(this.data));
            }
        };
    }

    function renderUniversal(items) {
        if (!isPlemiona()) return;

        const url = location.href;
        const id = new URLSearchParams(location.search).get('id') || '';

        items.forEach((i) => {
            if (!i || !i.page || !i.position) return;
            if (!(url.includes(i.page) || i.page === '*')) return;

            const target = document.querySelector(i.position);
            if (!target) return;

            const key = `tcm-mod-${i.page.replace(/\W/g, '')}`;
            if (target.querySelector(`[data-tcm="${key}"]`)) return;

            let html = '';
            if (/<[a-z][\s\S]*>/i.test(i.label || '')) {
                html = i.label.trim();
            } else {
                const style = i.style ? `style="${i.style}"` : '';
                const href = (i.url || '#').replace('{id}', id);
                html = `<a href="${href}" class="btn" target="_blank" ${style}>${i.label || ''}</a>`;
            }

            const positionMap = {
                append: 'beforeend',
                prepend: 'afterbegin',
                before: 'beforebegin',
                after: 'afterend'
            };
            const position = positionMap[i.method] || 'beforeend';
            target.insertAdjacentHTML(position, html);

            const addedEl = position === 'beforeend'
                ? target.lastElementChild
                : position === 'afterbegin'
                    ? target.firstElementChild
                    : position === 'afterend'
                        ? target.nextElementSibling
                        : target.previousElementSibling;

            if (addedEl) {
                addedEl.dataset.tcm = key;
                if (Array.isArray(i.items)) attachDropdown(addedEl, i);
            }
        });
    }

    function attachDropdown(parent, config) {
        const list = document.createElement('div');
        list.className = 'tcm-dropdown-menu';
        list.style.cssText = config.containerStyle || 'display:none;position:absolute;z-index:999999;background:#212529;border:1px solid #444;padding:5px 0;min-width:200px;';

        config.items.forEach((sub) => {
            const item = document.createElement('a');
            item.href = sub.url || '#';
            item.textContent = sub.label || '';
            item.style.cssText = config.itemStyle || 'display:block;padding:12px;color:white;text-decoration:none;border-bottom:1px solid #333;';
            item.target = '_blank';
            list.appendChild(item);
        });

        document.body.appendChild(list);
        parent.addEventListener('click', (e) => {
            if (parent.tagName === 'A' && parent.getAttribute('href') === '#') e.preventDefault();
            e.stopPropagation();
            const visible = list.style.display === 'block';
            document.querySelectorAll('.tcm-dropdown-menu').forEach((m) => m.style.display = 'none');
            if (!visible) {
                list.style.display = 'block';
                const r = parent.getBoundingClientRect();
                list.style.top = `${r.bottom + window.scrollY}px`;
                list.style.left = `${r.left + window.scrollX}px`;
            }
        });
        document.addEventListener('click', () => { list.style.display = 'none'; });
    }

    function waitForElement(selector, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const check = () => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (Date.now() - started >= timeout) return reject(new Error(`Nie znaleziono elementu: ${selector}`));
                requestAnimationFrame(check);
            };
            check();
        });
    }

    function setTextareaValue(textarea, value) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(textarea, value);
        else textarea.value = value;
        ['input', 'change', 'keyup'].forEach((type) => textarea.dispatchEvent(new Event(type, { bubbles: true })));
    }

    async function handleTWDatabasePage() {
        const path = location.pathname.toLowerCase();
        if (!['/reports', '/attacks'].includes(path)) return;
        try {
            const textarea = await waitForElement('.import-textarea', 10000);
            const stored = GM_getValue(`${APP_NAME}:clipboard`, '');
            if (!stored || !stored.trim()) return;
            setTextareaValue(textarea, stored);
            const submit = document.querySelector('form.import-form button[type="submit"]');
            if (submit && !submit.disabled && !textarea.dataset.tcmImported) {
                textarea.dataset.tcmImported = '1';
                setTimeout(() => submit.click(), 150);
            }
        } catch (e) {
            console.warn('[TW-DB] TWDatabase auto-fill failed:', e);
        }
    }

    function handlePlemionaImportButtons() {
        if (!isPlemiona()) return;
        if (!/screen=mail|screen=reqdef|screen=info_player|screen=report/i.test(location.href)) return;
        const ta = document.getElementById('message') || document.getElementById('simple_message');
        if (ta && ta.value.trim()) GM_setValue(`${APP_NAME}:clipboard`, ta.value);
    }

    async function initPlemionaModules() {
        if (!isPlemiona()) return;
        const master = await fetchJson(MASTER_CONFIG);
        if (!master || !Array.isArray(master)) return;
        for (const mod of master) {
            const raw = await fetchJson(mod.url);
            if (!raw) continue;
            normalize(raw).forEach((data) => {
                const module = createModule(data);
                App.modules.push(module);
                module.init();
            });
        }
    }

    const observer = new MutationObserver(() => {
        if (isPlemiona()) {
            const currentUrl = location.href;
            const currentVillage = new URLSearchParams(location.search).get('village');
            if (currentUrl !== App.state.url || currentVillage !== App.state.village) {
                App.state.url = currentUrl;
                App.state.village = currentVillage;
                App.modules.forEach((m) => { m.destroy(); m.init(); });
            } else {
                App.modules.forEach((m) => m.init());
            }
            handlePlemionaImportButtons();
        }
        if (isTWDatabase()) handleTWDatabasePage();
    });

    function start() {
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
        if (isTWDatabase()) handleTWDatabasePage();
        if (isPlemiona()) initPlemionaModules();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
