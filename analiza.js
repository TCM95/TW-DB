// ==UserScript==
// @name         Analizator TWDB
// @namespace    https://viayoo.com/
// @version      5.3
// @description  Ominięcie kolejki TW: bezpośredni zapis z interwałem 80-190ms między rozkazami
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

    const isTWDatabase = /(^|\.)twdatabase\.online$/i.test(location.hostname);
    const isPlemiona = /(^|\.)plemiona\.pl$/i.test(location.hostname);

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
            --tcm-bg-main: #36393f;
            --tcm-bg-header: #202225;
            --tcm-border: #3e4147;
            --tcm-text: #ffffff;
            --tcm-btn-bg: linear-gradient(#6e7178 0%, #36393f 30%, #202225 80%, #000000 100%);
            --tcm-btn-hover: linear-gradient(#7b7e85 0%, #40444a 30%, #393c40 80%, #171717 100%);
            --tcm-green-bg: linear-gradient(#5cad5c 0%, #2e7a2e 30%, #1f5c1f 80%, #0f2e0f 100%);
            --tcm-green-hover: linear-gradient(#6bbf6b 0%, #388c38 30%, #267326 80%, #143d14 100%);
            --tcm-blue-bg: linear-gradient(#5c8cad 0%, #2e5c7a 30%, #1f425c 80%, #0f222e 100%);
            --tcm-red-bg: linear-gradient(#ad5c5c 0%, #7a2e2e 30%, #5c1f1f 80%, #2e0f0f 100%);
        }

        .tcm-btn {
            appearance: none;
            border: 1px solid var(--tcm-border);
            border-radius: 4px;
            background: var(--tcm-btn-bg);
            color: var(--tcm-text);
            padding: 10px 15px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            line-height: 1.2;
            text-align: center;
            transition: filter 120ms ease;
        }

        .tcm-btn:hover { filter: brightness(1.15); }
        .tcm-btn-green { background: var(--tcm-green-bg); }
        .tcm-btn-green:hover { background: var(--tcm-green-hover); }
        .tcm-btn-blue { background: var(--tcm-blue-bg); }
        .tcm-btn-red { background: var(--tcm-red-bg); }

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
            background: var(--tcm-bg-main);
            border: 1px solid var(--tcm-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.55);
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
        button.classList.remove('tcm-btn-green', 'tcm-btn-blue', 'tcm-btn-red');
        if (className) button.classList.add(className);

        setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = originalText;
            button.classList.remove('tcm-btn-green', 'tcm-btn-blue', 'tcm-btn-red');
            button.classList.add('tcm-btn-green');
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
        return Array.from(document.querySelectorAll('#incomings_table tr.nowrap, #incomings_table tbody tr, table#incomings_table tr'));
    }

    function getIncomingCoordinates(row) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        let target = getCoordinates(cells[1]);
        let origin = getCoordinates(cells[2]);

        if (!target || !origin) {
            const coordinates = Array.from(row.textContent.matchAll(/\b\d{1,3}\|\d{1,3}\b/g)).map(match => match[0]);
            target = target || coordinates[0] || null;
            origin = origin || coordinates[1] || null;
        }
        return { target, origin };
    }

    function colorIncomingRows(analysisArray) {
        if (!analysisArray || !analysisArray.length) return;
        getIncomingRows().forEach((row) => {
            if (row.dataset.tcmColored) return; 
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (match && Array.isArray(match.c)) {
                const firstCell = row.querySelector(':scope > td');
                if (firstCell) {
                    firstCell.style.background = getBackgroundStyle(match.c);
                    row.dataset.tcmColored = '1'; 
                }
            }
        });
    }

    function getRandomDelay(min = 80, max = 190) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Rekurencyjna funkcja wysyłająca surowe żądania omijając skrypty gry
    function processNext(items, index) {
        if (index >= items.length) {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(`Zakończono zapis ${items.length} nazw!`, 3000, 'success');
            return;
        }

        const item = items[index];
        const csrf = typeof window.game_data !== 'undefined' ? window.game_data.csrf : '';
        const villageId = typeof window.game_data !== 'undefined' ? window.game_data.village.id : '';

        const quickedit = item.row.querySelector('.quickedit');
        let commandId = quickedit ? quickedit.getAttribute('data-id') : null;

        if (!commandId) {
            const checkbox = item.row.querySelector('input[name="command_ids[]"]');
            if (checkbox) commandId = checkbox.value;
        }

        if (commandId && csrf) {
            const url = `/game.php?village=${villageId}&screen=info_command&ajaxaction=edit_other_comment&id=${commandId}&h=${csrf}`;
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
                if (quickedit) {
                    const label = quickedit.querySelector('.quickedit-label');
                    const editBox = quickedit.querySelector('.quickedit-edit');
                    
                    if (label) {
                        label.innerHTML = item.newLabel;
                        label.style.display = '';
                    }
                    if (editBox) {
                        editBox.style.display = 'none';
                    }
                }
            }).catch(err => console.error('[TWDB] Błąd fetch:', err));
        }

        // Ustawienie losowego interwału do wykonania kolejnego strzału
        setTimeout(() => processNext(items, index + 1), getRandomDelay(80, 190));
    }

    function loadAnalysesToGame() {
        const analysisArray = loadAnalysisData();
        if (!analysisArray.length) {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage('Brak zapisanych danych z TWDB!', 3000, 'error');
            return;
        }

        const rows = getIncomingRows();
        const itemsToProcess = [];
        let alreadyLabeledCount = 0;

        const originalFocus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function() {};

        // 1. Zbieranie zadań
        rows.forEach((row) => {
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (!match || !match.a) return;

            const labelElement = row.querySelector('.quickedit-label, .command-label, [class*="label"]');
            const currentLabel = labelElement ? getText(labelElement) : '';
            const cleanLabel = currentLabel.replace(/\[[^\]]*]/g, '').replace(/\s+/g, ' ').trim();
            const newLabel = cleanLabel ? `${cleanLabel} ${match.a}` : match.a;

            if (currentLabel === newLabel) {
                alreadyLabeledCount++;
                return;
            }

            const renameBtn = row.querySelector('.rename-icon, .quickedit-label ~ a, [class*="rename"]');
            if (renameBtn) itemsToProcess.push({ row, newLabel, renameBtn });
        });

        if (!itemsToProcess.length) {
            HTMLElement.prototype.focus = originalFocus;
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(alreadyLabeledCount > 0 ? `Wszystkie (${alreadyLabeledCount}) aktualne.` : 'Nie znaleziono pasujących komend.', 4000, alreadyLabeledCount > 0 ? 'success' : 'error');
            return;
        }

        // 2. Jednoczesne otworzenie wszystkich kontenerów edycji
        itemsToProcess.forEach(item => item.renameBtn.click());

        // 3. Wstrzyknięcie widoku (iluzja działania natywnego) i start wysyłania asynchronicznego omijając grę
        setTimeout(() => {
            itemsToProcess.forEach(item => {
                const input = item.row.querySelector('input[type="text"], input.quickedit-edit');
                if (input) {
                    input.setAttribute('inputmode', 'none');
                    input.value = item.newLabel;
                }
            });
            HTMLElement.prototype.focus = originalFocus;
            
            // Inicjalizacja bezpośredniego wysyłania (fetch co 80-190ms na obiekt)
            processNext(itemsToProcess, 0);

        }, 50);
    }

    function isIncomingPage() {
        return location.href.includes('screen=overview_villages') || location.href.includes('mode=incomings') || document.querySelector('#incomings_table') !== null;
    }

    function initPlemionaPanel() {
        if (!isPlemiona || !isIncomingPage() || document.querySelector('#tcm-twdb-nav-header')) return;

        const tableHeader = document.querySelector('#incomings_table tr th');
        if (!tableHeader) return;

        const navBtn = document.createElement('button');
        navBtn.id = 'tcm-twdb-nav-header';
        navBtn.className = 'tcm-btn tcm-btn-green';
        navBtn.innerHTML = '➡ TWDB';
        navBtn.style.cssText = 'padding:2px 8px; margin-left:10px; font-size:11px; vertical-align:middle;';
        
        navBtn.addEventListener('click', (e) => {
            e.preventDefault();
            GM_setValue('tcm_return_url', window.location.href);
            window.location.href = 'https://twdatabase.online/command-analyzer';
        });

        const loadBtn = document.createElement('button');
        loadBtn.id = 'tcm-twdb-btn-header';
        loadBtn.className = 'tcm-btn tcm-btn-blue';
        loadBtn.innerHTML = '⚙️ Wczytaj';
        loadBtn.style.cssText = 'padding:2px 8px; margin-left:5px; font-size:11px; vertical-align:middle;';
        
        loadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadAnalysesToGame();
        });

        tableHeader.appendChild(navBtn);
        tableHeader.appendChild(loadBtn);

        colorIncomingRows(loadAnalysisData());
    }

    function initPlemiona() {
        if (!isPlemiona || !document.body) return;
        initPlemionaPanel();
        const observer = new MutationObserver(throttle(() => {
            initPlemionaPanel();
            colorIncomingRows(loadAnalysisData());
        }, 300));
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (isTWDatabase) initTWDatabase();
    if (isPlemiona) initPlemiona();
})();
