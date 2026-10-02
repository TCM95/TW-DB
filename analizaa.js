// ==UserScript==
// @name         Analizator TWDB
// @namespace    https://viayoo.com/
// @version      6.5
// @description  Szybkie wysyłanie (200ms) + dokładny licznik dopasowań i aktualizacji
// @author       TCM
// @match        *://*.twdatabase.online/*
// @match        https://*.plemiona.pl/game.php*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'twdb_data';
    const COLOR_TOGGLE_KEY = 'twdb_color_enabled';

    const isTWDatabase = /(^|\.)twdatabase\.online$/i.test(location.hostname);
    const isPlemiona = /(^|\.)plemiona\.pl$/i.test(location.hostname);

    let isUpdating = false;
    let colorEnabled = GM_getValue(COLOR_TOGGLE_KEY, true);

    const throttle = (func, limit) => {
        let waiting = false;
        return function (...args) {
            if (!waiting) {
                waiting = true;
                setTimeout(() => {
                    func.apply(this, args);
                    waiting = false;
                }, limit);
            }
        };
    };

    const css = `
        :root {
            --bg-main: #36393f;
            --bg-row-alt: #32353b;
            --bg-header: #202225;
            --border-color: #3e4147;
            --text-color: white;
            --title-color: #ffffdf;
            --btn-bg: linear-gradient(#6e7178 0%, #36393f 30%, #202225 80%, black 100%);
            --btn-hover: linear-gradient(#7b7e85 0%, #40444a 30%, #393c40 80%, #171717 100%);
            --btn-green-bg: linear-gradient(#5cad5c 0%, #2e7a2e 30%, #1f5c1f 80%, #0f2e0f 100%);
            --btn-green-hover: linear-gradient(#6bbf6b 0%, #388c38 30%, #267326 80%, #143d14 100%);
            --btn-red-bg: linear-gradient(#ad5c5c 0%, #7a2e2e 30%, #5c1f1f 80%, #2e0f0f 100%);
            --btn-red-hover: linear-gradient(#bf6b6b 0%, #8c3838 30%, #732626 80%, #3d1414 100%);
            --btn-blue-bg: linear-gradient(#5c8cad 0%, #2e5c7a 30%, #1f425c 80%, #0f222e 100%);
            --btn-blue-hover: linear-gradient(#6ba3bf 0%, #38738c 30%, #265473 80%, #142e3d 100%);
        }

        .tcm-btn {
            appearance: none;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--btn-bg);
            color: var(--text-color);
            padding: 10px 15px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            line-height: 1.2;
            text-align: center;
            transition: background 120ms ease;
            white-space: nowrap;
        }

        .tcm-btn:hover { background: var(--btn-hover); }
        .tcm-btn-green { background: var(--btn-green-bg); }
        .tcm-btn-green:hover { background: var(--btn-green-hover); }
        .tcm-btn-blue { background: var(--btn-blue-bg); }
        .tcm-btn-blue:hover { background: var(--btn-blue-hover); }
        .tcm-btn-red { background: var(--btn-red-bg); }
        .tcm-btn-red:hover { background: var(--btn-red-hover); }

        .tcm-floating-panel {
            position: fixed !important;
            right: 10px !important;
            top: 50% !important;
            transform: translateY(-50%) !important;
            z-index: 999999 !important;
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            background: var(--bg-main);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
        }

        .tcm-header-container {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin-left: 10px;
            vertical-align: middle;
        }
    `;

    if (typeof GM_addStyle === 'function') {
        GM_addStyle(css);
    } else {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function getText(element) {
        return (element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function getCoordinates(textOrElement) {
        if (!textOrElement) return null;
        const text = typeof textOrElement === 'string' ? textOrElement : getText(textOrElement);
        const match = text.match(/\b(\d{1,3}\|\d{1,3})\b/);
        return match ? match[1] : null;
    }

    function getBadgeColor(badge) {
        if (badge.classList.contains('village-analysis-badge--warn')) return '#ff4d4d';
        if (badge.classList.contains('village-analysis-badge--good')) return '#31c908';
        if (badge.classList.contains('village-analysis-badge--info')) return '#0d83dd';
        if (badge.classList.contains('village-analysis-badge--danger') || badge.classList.contains('village-analysis-badge--bad')) return '#ff4d4d';
        return '#708090';
    }

    function loadAnalysisData() {
        const raw = GM_getValue(STORAGE_KEY, '');
        if (!raw) return [];
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) { return []; }
    }

    function saveAnalysisData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function showButtonStatus(button, text, className, timeout = 4000) {
        const originalText = button.dataset.originalText || 'Zapisz analizy';
        button.textContent = text;
        button.className = `tcm-btn ${className}`;

        setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = originalText;
            button.className = 'tcm-btn tcm-btn-green';
        }, timeout);
    }

    /* === TW DATABASE === */
    function collectTWDatabaseAnalyses() {
        const result = [];
        document.querySelectorAll('table tbody tr').forEach((row) => {
            const cells = row.querySelectorAll(':scope > td');
            if (cells.length < 9) return; 

            const target = getCoordinates(cells[1]);
            const origin = getCoordinates(cells[2]);
            const analysisCell = cells[8];

            if (!target || !origin || !analysisCell) return;

            const badges = [], colors = [];
            analysisCell.querySelectorAll('.village-analysis-badge').forEach((badge) => {
                const badgeText = getText(badge);
                if (!badgeText) return;
                badges.push(badgeText);
                colors.push(getBadgeColor(badge));
            });

            if (badges.length) result.push({ t: target, o: origin, a: `[${badges.join('|')}]`, c: colors });
        });
        return result;
    }

    function initTWDatabase() {
        if (!isTWDatabase || !document.body || document.querySelector('#tcm-twdb-panel') || !location.href.includes('command-analyzer')) return;

        const panel = document.createElement('div');
        panel.id = 'tcm-twdb-panel';
        panel.className = 'tcm-floating-panel';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tcm-btn tcm-btn-green';
        button.textContent = '💾 Zapisz analizy do gry';
        button.dataset.originalText = '💾 Zapisz analizy do gry';

        panel.appendChild(button);
        document.body.appendChild(panel);

        button.addEventListener('click', () => {
            const data = collectTWDatabaseAnalyses();
            if (!data.length) return showButtonStatus(button, 'Brak analiz', 'tcm-btn-red');
            
            saveAnalysisData(data);
            showButtonStatus(button, `Zapisano: ${data.length}`, 'tcm-btn-blue');

            const returnUrl = GM_getValue('tcm_return_url');
            if (returnUrl) setTimeout(() => { window.location.href = returnUrl; }, 800);
        });
    }

    /* === PLEMIONA === */
    function getBackgroundStyle(colors) {
        if (!Array.isArray(colors) || !colors.length) return '';
        if (colors.length === 1) return colors[0];
        const step = 100 / colors.length;
        const parts = colors.map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`);
        return `linear-gradient(to right, ${parts.join(', ')})`;
    }

    function findAnalysis(analysisArray, target, origin) {
        if (!target || !origin) return null;
        return analysisArray.find(item => item && item.t === target && item.o === origin) || null;
    }

    function getIncomingRows() {
        return Array.from(document.querySelectorAll('#incomings_table tr')).filter(row => row.querySelector('.quickedit[data-id]'));
    }

    function getIncomingCoordinates(row) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        
        let target = cells[1] ? getCoordinates(cells[1]) : null;
        let origin = cells[2] ? getCoordinates(cells[2]) : null;

        if (!target || !origin) {
            const coordinates = Array.from(row.textContent.matchAll(/\b\d{1,3}\|\d{1,3}\b/g)).map(match => match[0]);
            target = target || coordinates[0] || null;
            origin = origin || coordinates[1] || null;
        }
        return { target, origin };
    }

    function applyOrClearColors() {
        const analysisArray = loadAnalysisData();
        getIncomingRows().forEach((row) => {
            const firstCell = row.querySelector(':scope > td');
            if (!firstCell) return;

            if (!colorEnabled) {
                firstCell.style.background = '';
                delete row.dataset.tcmColored;
                return;
            }

            if (row.dataset.tcmColored) return; 
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (match && Array.isArray(match.c)) {
                firstCell.style.background = getBackgroundStyle(match.c);
                row.dataset.tcmColored = '1'; 
            }
        });
    }

    function getRandomDelay(min = 250, max = 260) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function updateTextNodeOnly(element, newText) {
        if (!element) return;
        const textNodes = Array.from(element.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
        const targetNode = textNodes.find(n => n.textContent.trim().length > 0);
        
        if (targetNode) {
            targetNode.nodeValue = ' ' + newText + ' ';
        } else {
            element.prepend(document.createTextNode(' ' + newText + ' '));
        }
    }

    function processNextHeadless(items, index, btnEl, stats) {
        const totalToProcess = items.length;

        if (index >= totalToProcess) {
            isUpdating = false; 
            applyOrClearColors();
            
            if (btnEl) btnEl.innerHTML = `✅ ${stats.totalMatched}/${stats.totalMatched}`;
            
            const message = `Zakończono! Zaktualizowano ${totalToProcess} komend` + 
                            (stats.alreadyLabeled > 0 ? ` (Pominięto ${stats.alreadyLabeled} już aktualnych)` : '') + `. Łącznie: ${stats.totalMatched}.`;
            
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(message, 4000, 'success');
            
            setTimeout(() => { if (btnEl && !isUpdating) btnEl.innerHTML = '⚙️ Wczytaj'; }, 4000);
            return;
        }

        const currentProcessed = stats.alreadyLabeled + index + 1;
        if (btnEl) btnEl.innerHTML = `⌛ ${currentProcessed} z ${stats.totalMatched}`;

        const item = items[index];
        const csrf = typeof window.game_data !== 'undefined' ? window.game_data.csrf : '';
        const villageId = typeof window.game_data !== 'undefined' ? window.game_data.village.id : '';

        if (item.commandId && csrf) {
            const url = `/game.php?village=${villageId}&screen=info_command&ajaxaction=edit_other_comment&id=${item.commandId}&h=${csrf}`;
            const formData = new URLSearchParams();
            formData.append('text', item.newLabel);

            fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: formData.toString()
            }).then(() => {
                if (item.labelElement) updateTextNodeOnly(item.labelElement, item.newLabel);
            }).catch(err => console.error('[TWDB] Błąd sieci:', err));
        }

        setTimeout(() => processNextHeadless(items, index + 1, btnEl, stats), getRandomDelay(200, 280));
    }

    function loadAnalysesToGame(btnEl) {
        const analysisArray = loadAnalysisData();
        if (!analysisArray.length) {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage('Brak zapisanych danych z TWDB!', 3000, 'error');
            return;
        }

        const rows = getIncomingRows();
        const itemsToProcess = [];
        let alreadyLabeledCount = 0;
        let totalMatched = 0;

        rows.forEach((row) => {
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (!match || !match.a) return;

            const quickedit = row.querySelector('.quickedit');
            if (!quickedit) return;

            const commandId = quickedit.getAttribute('data-id');
            const labelContainer = quickedit.querySelector('.quickedit-label');
            
            if (!commandId || !labelContainer) return;
            
            totalMatched++;

            const currentLabel = getText(labelContainer);
            const cleanLabel = currentLabel.replace(/\[[^\]]*]/g, '').replace(/\s+/g, ' ').trim();
            const newLabel = cleanLabel ? `${cleanLabel} ${match.a}` : match.a;

            if (currentLabel === newLabel) {
                alreadyLabeledCount++;
                return;
            }

            itemsToProcess.push({ 
                commandId: commandId, 
                newLabel: newLabel, 
                labelElement: labelContainer
            });
        });

        if (!totalMatched) {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage('Nie znaleziono pasujących komend z bazy w tym widoku.', 4000, 'error');
            return;
        }

        if (!itemsToProcess.length) {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(`Wszystkie znalezione komendy (${totalMatched}) są już aktualne!`, 4000, 'success');
            if (btnEl) btnEl.innerHTML = `✅ ${totalMatched}/${totalMatched}`;
            setTimeout(() => { if (btnEl) btnEl.innerHTML = '⚙️ Wczytaj'; }, 3000);
            return;
        }

        isUpdating = true; 
        const stats = { totalMatched: totalMatched, alreadyLabeled: alreadyLabeledCount };
        
        if (typeof UI !== 'undefined' && UI.InfoMessage) {
            UI.InfoMessage(`Dopasowano ${totalMatched} komend. Rozpoczynam zapis ${itemsToProcess.length} nowych...`, 3000, 'success');
        }
        
        processNextHeadless(itemsToProcess, 0, btnEl, stats);
    }

    function isIncomingPage() {
        return location.href.includes('screen=overview_villages') || location.href.includes('mode=incomings') || document.querySelector('#incomings_table') !== null;
    }

    function initPlemionaPanel() {
        if (!isPlemiona || !isIncomingPage() || document.querySelector('#tcm-twdb-nav-header')) return;

        const tableHeader = document.querySelector('#incomings_table tr th');
        if (!tableHeader) return;

        const container = document.createElement('span');
        container.id = 'tcm-twdb-nav-header';
        container.className = 'tcm-header-container';

        const navBtn = document.createElement('button');
        navBtn.className = 'tcm-btn tcm-btn-green';
        navBtn.innerHTML = '➡ TWDB';
        navBtn.style.cssText = 'padding:2px 8px; font-size:11px;';
        
        navBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isUpdating) return;
            GM_setValue('tcm_return_url', window.location.href);
            window.location.href = 'https://twdatabase.online/command-analyzer';
        });

        const loadBtn = document.createElement('button');
        loadBtn.className = 'tcm-btn tcm-btn-blue';
        loadBtn.innerHTML = '⚙️ Wczytaj';
        loadBtn.style.cssText = 'padding:2px 8px; font-size:11px; min-width: 90px;';
        
        loadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (isUpdating) return;
            loadAnalysesToGame(loadBtn);
        });

        const colorToggleBtn = document.createElement('button');
        colorToggleBtn.className = colorEnabled ? 'tcm-btn tcm-btn-green' : 'tcm-btn tcm-btn-red';
        colorToggleBtn.innerHTML = colorEnabled ? '🎨 Kolory: WŁ' : '🎨 Kolory: WYŁ';
        colorToggleBtn.style.cssText = 'padding:2px 8px; font-size:11px; min-width: 90px;';

        colorToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            colorEnabled = !colorEnabled;
            GM_setValue(COLOR_TOGGLE_KEY, colorEnabled);
            colorToggleBtn.className = colorEnabled ? 'tcm-btn tcm-btn-green' : 'tcm-btn tcm-btn-red';
            colorToggleBtn.innerHTML = colorEnabled ? '🎨 Kolory: WŁ' : '🎨 Kolory: WYŁ';
            applyOrClearColors();
        });

        container.appendChild(navBtn);
        container.appendChild(loadBtn);
        container.appendChild(colorToggleBtn);
        
        tableHeader.appendChild(container);
        applyOrClearColors();
    }

    function initPlemiona() {
        if (!isPlemiona || !document.body) return;
        initPlemionaPanel();
        
        const observer = new MutationObserver(throttle(() => {
            if (isUpdating) return; 
            initPlemionaPanel();
            applyOrClearColors();
        }, 300));
        
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (isTWDatabase) initTWDatabase();
    if (isPlemiona) initPlemiona();
})();
