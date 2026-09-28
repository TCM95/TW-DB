// ==UserScript==
// @name         Analizator TWDB
// @namespace    https://viayoo.com/
// @version      4.5
// @description  Łączy analizy TW Database z widokiem ataków, pozwala na szybką nawigację i aktualizację zmian
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
    
    // CACHE - Pamięć podręczna dla MutationObservera
    let cachedAnalysisArray = null;

    /*
     * ============================
     * WSPÓLNE FUNKCJE
     * ============================
     */

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

        .tcm-btn:hover {
            background: var(--tcm-btn-hover);
            filter: brightness(1.15);
        }

        .tcm-btn-green { background: var(--tcm-green-bg); }
        .tcm-btn-green:hover { background: var(--tcm-green-hover); }
        .tcm-btn-blue { background: var(--tcm-blue-bg); }
        .tcm-btn-red { background: var(--tcm-red-bg); }

        .tcm-floating-panel {
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 999999;
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
        (document.head || document.documentElement).appendChild(style);
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
        } catch (error) {
            console.error('[TWDB] Nie można odczytać zapisanych analiz:', error);
            return [];
        }
    }

    function getCachedAnalysis() {
        if (!cachedAnalysisArray) cachedAnalysisArray = loadAnalysisData();
        return cachedAnalysisArray;
    }

    function saveAnalysisData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
        cachedAnalysisArray = data; // Aktualizacja pamięci po zapisie
    }

    function showButtonStatus(button, text, className, timeout = 4000) {
        const originalText = button.dataset.originalText || 'Zapisz analizy';
        button.textContent = text;
        button.classList.remove('tcm-btn-green', 'tcm-btn-blue', 'tcm-btn-red');
        if (className) button.classList.add(className);

        window.setTimeout(() => {
            if (!button.isConnected) return;
            button.textContent = originalText;
            button.classList.remove('tcm-btn-green', 'tcm-btn-blue', 'tcm-btn-red');
            button.classList.add('tcm-btn-green');
        }, timeout);
    }

    /*
     * ============================
     * TW DATABASE
     * ============================
     */

    function collectTWDatabaseAnalyses() {
        const result = [];
        const rows = document.querySelectorAll('table.ap-table tbody tr');

        rows.forEach((row) => {
            const cells = row.querySelectorAll(':scope > td');
            const target = getCoordinates(cells[1]);
            const origin = getCoordinates(cells[2]);
            const analysisCell = cells[8];

            if (!target || !origin || !analysisCell) return;

            const badges = [];
            const colors = [];

            analysisCell.querySelectorAll('.village-analysis-badge').forEach((badge) => {
                const badgeText = getText(badge);
                if (!badgeText) return;
                badges.push(badgeText);
                colors.push(getBadgeColor(badge));
            });

            if (!badges.length) return;

            result.push({
                t: target,
                o: origin,
                a: `[${badges.join('|')}]`,
                c: colors
            });
        });

        return result;
    }

    function initTWDatabasePanel() {
        if (document.querySelector('#tcm-twdb-panel') || !document.querySelector('table.ap-table')) return;

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

            if (!data.length) {
                showButtonStatus(button, 'Brak analiz', 'tcm-btn-red');
                return;
            }

            saveAnalysisData(data);
            showButtonStatus(button, `Zapisano: ${data.length}`, 'tcm-btn-blue');

            const returnUrl = GM_getValue('tcm_return_url');
            if (returnUrl) {
                window.setTimeout(() => {
                    window.location.href = returnUrl;
                }, 800);
            }
        });
    }

    function initTWDatabase() {
        if (!isTWDatabase || !document.body) return;
        initTWDatabasePanel();
        const observer = new MutationObserver(() => initTWDatabasePanel());
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /*
     * ============================
     * PLEMIONA
     * ============================
     */

    function getBackgroundStyle(colors) {
        if (!Array.isArray(colors) || !colors.length) return '';
        if (colors.length === 1) return colors[0];

        const step = 100 / colors.length;
        const parts = colors.map((color, index) => {
            const start = index * step;
            const end = (index + 1) * step;
            return `${color} ${start}% ${end}%`;
        });

        return `linear-gradient(to right, ${parts.join(', ')})`;
    }

    function findAnalysis(analysisArray, target, origin) {
        if (!target || !origin) return null;
        return analysisArray.find((item) => item && item.t === target && item.o === origin) || null;
    }

    function getIncomingRows() {
        return Array.from(document.querySelectorAll('#incomings_table tr.nowrap, #incomings_table tbody tr, table#incomings_table tr'));
    }

    function getIncomingCoordinates(row) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        let target = getCoordinates(cells[1]);
        let origin = getCoordinates(cells[2]);

        if (!target || !origin) {
            const coordinates = Array.from((row.textContent || '').matchAll(/\b\d{1,3}\|\d{1,3}\b/g)).map((match) => match[0]);
            target = target || coordinates[0] || null;
            origin = origin || coordinates[1] || null;
        }

        return { target, origin };
    }

    function findRenameButton(row) {
        return row.querySelector('.rename-icon, .quickedit-label ~ a, [class*="rename"], [data-action="rename"], a[href*="rename"]');
    }

    function findLabelElement(row) {
        return row.querySelector('.quickedit-label, .command-label, [class*="label"]');
    }

    function findRenameInput(row) {
        return row.querySelector('input[type="text"], input.quickedit-edit, input[name*="label"], input[name*="name"]');
    }

    function findRenameSaveButton(row) {
        return row.querySelector('input[type="button"], button[type="submit"], button, .quickedit-save');
    }

    function getCurrentLabel(row) {
        const labelElement = findLabelElement(row);
        return labelElement ? getText(labelElement) : '';
    }

    function buildNewLabel(currentLabel, analysisTag) {
        const cleanLabel = (currentLabel || '').replace(/\[[^\]]*]/g, '').replace(/\s+/g, ' ').trim();
        return cleanLabel ? `${cleanLabel} ${analysisTag}` : analysisTag;
    }

    function setNativeInputValue(input, value) {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor && descriptor.set) {
            descriptor.set.call(input, value);
        } else {
            input.value = value;
        }
        ['input', 'change', 'keyup'].forEach(eventType => {
            input.dispatchEvent(new Event(eventType, { bubbles: true }));
        });
    }

    function renameIncomingCommand(row, newLabel) {
        const renameButton = findRenameButton(row);
        if (!renameButton) return false;

        renameButton.click();

        window.setTimeout(() => {
            const input = findRenameInput(row);
            if (!input) return;

            setNativeInputValue(input, newLabel);
            const saveButton = findRenameSaveButton(row);

            if (saveButton && saveButton !== renameButton) {
                saveButton.click();
            } else {
                ['keydown', 'keyup'].forEach(eventType => {
                    input.dispatchEvent(new KeyboardEvent(eventType, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                });
            }
        }, 250);
    }

    function colorIncomingRows(analysisArray) {
        if (!analysisArray || !analysisArray.length) return;
        const rows = getIncomingRows();
        
        rows.forEach((row) => {
            if (row.dataset.tcmColored) return;
            
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (match && Array.isArray(match.c)) {
                const firstCell = row.querySelector(':scope > td');
                if (firstCell) {
                    // DODANO: 'important', aby nadpisać sztywne klasy Plemion (.row_a, .row_b)
                    firstCell.style.setProperty('background', getBackgroundStyle(match.c), 'important');
                }
            }
            
            row.dataset.tcmColored = 'true';
        });
    }

    function loadAnalysesToGame(btnElement) {
        // Zawsze pobieraj najświeższe dane po kliknięciu na wypadek zmiany w innej karcie
        const analysisArray = loadAnalysisData();

        // LOGIKA DWUSTOPNIOWEGO PRZYCISKU
        if (!analysisArray.length) {
            // Jeśli przycisk jest już w trybie przekierowania (drugie kliknięcie)
            if (btnElement && btnElement.dataset.redirectMode === 'true') {
                GM_setValue('tcm_return_url', window.location.href);
                window.location.href = 'https://twdatabase.online/command-analyzer/players/849206514';
                return;
            }

            // Pierwsze kliknięcie, gdy brak danych - zmiana w przycisk nawigacyjny
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage('Brak zapisanych danych z TWDB! Kliknij ponownie, aby przejść do analizy.', 4000, 'error');
            
            if (btnElement) {
                const originalHTML = btnElement.innerHTML;
                btnElement.innerHTML = '➡️ Idź do TWDB';
                btnElement.classList.remove('tcm-btn-blue');
                btnElement.classList.add('tcm-btn-red');
                btnElement.dataset.redirectMode = 'true';

                // Reset przycisku po 5 sekundach
                window.setTimeout(() => {
                    if (btnElement.isConnected) {
                        btnElement.innerHTML = originalHTML;
                        btnElement.classList.remove('tcm-btn-red');
                        btnElement.classList.add('tcm-btn-blue');
                        btnElement.dataset.redirectMode = 'false';
                    }
                }, 5000);
            }
            return;
        }

        // Standardowa logika zmiany nazw
        const rows = getIncomingRows();
        let delay = 0;
        let changesCount = 0;
        let alreadyLabeledCount = 0;

        rows.forEach((row) => {
            const { target, origin } = getIncomingCoordinates(row);
            const match = findAnalysis(analysisArray, target, origin);

            if (!match || !match.a) return;

            const currentLabel = getCurrentLabel(row);
            const newLabel = buildNewLabel(currentLabel, match.a);
            
            if (currentLabel === newLabel) {
                alreadyLabeledCount++; 
                return;
            }

            window.setTimeout(() => {
                renameIncomingCommand(row, newLabel);
            }, delay);

            delay += 1300;
            changesCount += 1;
        });

        if (changesCount > 0) {
            const message = `Rozpoczęto zmianę nazw. Liczba komend: ${changesCount}. Przewidywany czas: ${(changesCount * 1.3).toFixed(1)} s.`;
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(message, 5000, 'success');
        } else if (alreadyLabeledCount > 0) {
            const message = `Wszystkie pasujące komendy (${alreadyLabeledCount}) są już aktualne (brak zmian na TWDB).`;
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage(message, 4000, 'success');
        } else {
            if (typeof UI !== 'undefined' && UI.InfoMessage) UI.InfoMessage('Nie znaleziono komend pasujących do zapisanych analiz.', 4000, 'error');
        }
    }

    function isIncomingPage() {
        return (
            location.href.includes('screen=overview_villages') ||
            location.href.includes('mode=incomings') ||
            document.querySelector('#incomings_table') !== null
        );
    }

    function initPlemionaPanel() {
        if (!isPlemiona || !isIncomingPage()) return;
        
        if (document.querySelector('#tcm-twdb-nav-header')) return;

        const tableHeader = document.querySelector('#incomings_table tr th');
        if (!tableHeader) return;

        const navButton = document.createElement('button');
        navButton.id = 'tcm-twdb-nav-header';
        navButton.type = 'button';
        navButton.className = 'tcm-btn tcm-btn-green';
        navButton.innerHTML = '➡️ TWDB';
        navButton.style.padding = '2px 8px';
        navButton.style.marginLeft = '10px';
        navButton.style.fontSize = '11px';
        navButton.style.verticalAlign = 'middle';

        tableHeader.appendChild(navButton);

        navButton.addEventListener('click', (e) => {
            e.preventDefault();
            GM_setValue('tcm_return_url', window.location.href);
            window.location.href = 'https://twdatabase.online/command-analyzer/players/849206514';
        });

        const button = document.createElement('button');
        button.id = 'tcm-twdb-btn-header';
        button.type = 'button';
        button.className = 'tcm-btn tcm-btn-blue';
        button.innerHTML = '⚙️ Wczytaj';
        button.style.padding = '2px 8px';
        button.style.marginLeft = '5px';
        button.style.fontSize = '11px';
        button.style.verticalAlign = 'middle';

        tableHeader.appendChild(button);

        button.addEventListener('click', (e) => {
            e.preventDefault();
            loadAnalysesToGame(button); // Przekazujemy referencję przycisku dla trybu przekierowania
        });
    }

    function initPlemiona() {
        if (!isPlemiona || !document.body) return;

        initPlemionaPanel();
        colorIncomingRows(getCachedAnalysis());

        const observer = new MutationObserver(() => {
            initPlemionaPanel();
            colorIncomingRows(getCachedAnalysis());
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /*
     * ============================
     * START
     * ============================
     */

    if (isTWDatabase) initTWDatabase();
    if (isPlemiona) initPlemiona();
})();
