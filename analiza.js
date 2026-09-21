// TW-DB attack analysis module.
// Loaded by pierdzik.js with @require.
(function () {
    'use strict';

    const STORAGE_KEY = 'twdb_data';
    const isTWDatabase = /(^|\.)twdatabase\.online$/i.test(location.hostname);
    const isPlemiona = /(^|\.)plemiona\.pl$/i.test(location.hostname);

    function getText(element) {
        return (element?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function getCoordinates(element) {
        const match = getText(element).match(/\b(\d{1,3}\|\d{1,3})\b/);
        return match ? match[1] : null;
    }

    function readData() {
        try {
            const raw = GM_getValue(STORAGE_KEY, '[]');
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn('[TWDB] Nie można odczytać analiz:', error);
            return [];
        }
    }

    function badgeColor(badge) {
        if (badge.classList.contains('village-analysis-badge--warn') ||
            badge.classList.contains('village-analysis-badge--bad') ||
            badge.classList.contains('village-analysis-badge--danger')) return '#ff4d4d';
        if (badge.classList.contains('village-analysis-badge--good')) return '#31c908';
        if (badge.classList.contains('village-analysis-badge--info')) return '#0d83dd';
        return '#708090';
    }

    function collectAnalyses() {
        const result = [];

        document.querySelectorAll('table.ap-table tbody tr').forEach((row) => {
            const cells = row.querySelectorAll(':scope > td');
            const target = getCoordinates(cells[1]);
            const origin = getCoordinates(cells[2]);
            const analysisCell = cells[8];

            if (!target || !origin || !analysisCell) return;

            const badges = [];
            const colors = [];
            analysisCell.querySelectorAll('.village-analysis-badge').forEach((badge) => {
                const text = getText(badge);
                if (!text) return;
                badges.push(text);
                colors.push(badgeColor(badge));
            });

            if (badges.length) {
                result.push({
                    t: target,
                    o: origin,
                    a: `[${badges.join('|')}]`,
                    c: colors
                });
            }
        });

        return result;
    }

    function initTWDatabase() {
        if (!isTWDatabase || document.querySelector('#tcm-save-analysis')) return;
        if (!document.querySelector('table.ap-table')) return;

        const button = document.createElement('button');
        button.id = 'tcm-save-analysis';
        button.type = 'button';
        button.className = 'btn';
        button.textContent = '📊 Zapisz analizy';
        button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:999999;cursor:pointer;';

        button.addEventListener('click', () => {
            const data = collectAnalyses();
            if (!data.length) {
                button.textContent = '⚠ Brak analiz';
                setTimeout(() => { button.textContent = '📊 Zapisz analizy'; }, 3000);
                return;
            }

            GM_setValue(STORAGE_KEY, JSON.stringify(data));
            button.textContent = `✓ Zapisano: ${data.length}`;
            setTimeout(() => { button.textContent = '📊 Zapisz analizy'; }, 4000);
        });

        document.body.appendChild(button);
    }

    function getIncomingRows() {
        return Array.from(document.querySelectorAll(
            '#incomings_table tbody tr, #incomings_table tr.nowrap'
        ));
    }

    function getIncomingCoordinates(row) {
        const cells = row.querySelectorAll(':scope > td');
        let target = getCoordinates(cells[1]);
        let origin = getCoordinates(cells[2]);

        if (!target || !origin) {
            const coordinates = [...(row.textContent || '').matchAll(/\b\d{1,3}\|\d{1,3}\b/g)]
                .map((match) => match[0]);
            target = target || coordinates[0] || null;
            origin = origin || coordinates[1] || null;
        }

        return { target, origin };
    }

    function findLabel(row) {
        return row.querySelector('.quickedit-label, .command-label, [class*="label"]');
    }

    function findRenameButton(row) {
        return row.querySelector(
            '.rename-icon, [data-action="rename"], [class*="rename"], a[href*="rename"]'
        );
    }

    function renameCommand(row, value) {
        const renameButton = findRenameButton(row);
        if (!renameButton) {
            console.warn('[TWDB] Nie znaleziono przycisku zmiany nazwy komendy.', row);
            return;
        }

        renameButton.click();
        setTimeout(() => {
            const input = row.querySelector(
                'input[type="text"], input.quickedit-edit, input[name*="label"], input[name*="name"]'
            );
            if (!input) return;

            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(input, value);
            else input.value = value;

            ['input', 'change', 'keyup'].forEach((type) => {
                input.dispatchEvent(new Event(type, { bubbles: true }));
            });

            const saveButton = row.querySelector(
                'input[type="button"], button[type="submit"], .quickedit-save'
            );
            if (saveButton) saveButton.click();
            else input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
        }, 250);
    }

    function initPlemionaButton() {
        if (!isPlemiona || document.querySelector('#tcm-analyse-incomings')) return;

        const table = document.querySelector('#incomings_table');
        if (!table) return;

        // Plemiona używa tutaj zwykłego pierwszego <tr>, bez <thead>.
        const header = table.querySelector('thead tr') || table.querySelector(':scope > tbody > tr') || table.querySelector(':scope > tr');
        const commandHeader = header?.querySelector('th');
        if (!commandHeader) return;

        const button = document.createElement('a');
        button.id = 'tcm-analyse-incomings';
        button.href = '#';
        button.className = 'btn';
        button.title = 'Dodaj analizy TWDB do nazw komend';
        button.textContent = '📊 Analizuj';
        button.style.cssText = 'margin-left:6px;cursor:pointer;white-space:nowrap;';
        commandHeader.appendChild(button);

        button.addEventListener('click', (event) => {
            event.preventDefault();

            const data = readData();
            if (!data.length) {
                if (typeof UI !== 'undefined' && UI.ErrorMessage) UI.ErrorMessage('Brak zapisanych analiz z TWDB.', 3000);
                else alert('Brak zapisanych analiz z TWDB. Najpierw zapisz je na stronie TWDB.');
                return;
            }

            let delay = 0;
            let count = 0;

            getIncomingRows().forEach((row) => {
                const { target, origin } = getIncomingCoordinates(row);
                const match = data.find((item) => item.t === target && item.o === origin);
                if (!match?.a) return;

                const label = findLabel(row);
                const current = getText(label);
                if (current.includes(match.a)) return;

                const clean = current.replace(/\[[^\]]*]/g, '').replace(/\s+/g, ' ').trim();
                const newLabel = clean ? `${clean} ${match.a}` : match.a;
                setTimeout(() => renameCommand(row, newLabel), delay);
                delay += 1300;
                count += 1;
            });

            button.textContent = count ? `✓ Zmieniono: ${count}` : 'Brak pasujących';
            setTimeout(() => { button.textContent = '📊 Analizuj'; }, 4000);
        });
    }

    function start() {
        if (!document.body) return;

        const run = () => {
            if (isTWDatabase) initTWDatabase();
            if (isPlemiona) initPlemionaButton();
        };

        run();
        new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
