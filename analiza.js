// ==UserScript==
// @name         TW-DB Analiza ataków
// @namespace    https://viayoo.com/
// @version      1.0.0
// @description  Zapisuje analizy z TW-DB i dodaje przycisk Analizuj do nagłówka tabeli przychodzących
// @author       TCM
// @match        *://*.twdatabase.online/*
// @match        *://*.plemiona.pl/game.php?*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'twdb_data';
    const isTWDatabase = /(^|\.)twdatabase\.online$/i.test(location.hostname);
    const isPlemiona = /(^|\.)plemiona\.pl$/i.test(location.hostname);

    function coordinates(element) {
        const match = (element?.textContent || '').match(/\b(\d{1,3}\|\d{1,3})\b/);
        return match ? match[1] : null;
    }

    function readData() {
        try {
            const value = GM_getValue(STORAGE_KEY, '[]');
            const data = typeof value === 'string' ? JSON.parse(value) : value;
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.warn('[TW-DB] Nie można odczytać analiz:', error);
            return [];
        }
    }

    function badgeColor(badge) {
        if (badge.classList.contains('village-analysis-badge--warn') ||
            badge.classList.contains('village-analysis-badge--bad')) return '#ff4d4d';
        if (badge.classList.contains('village-analysis-badge--good')) return '#31c908';
        if (badge.classList.contains('village-analysis-badge--info')) return '#0d83dd';
        return '#708090';
    }

    function collectAnalyses() {
        const result = [];

        document.querySelectorAll('table.ap-table tbody tr').forEach((row) => {
            const cells = row.querySelectorAll(':scope > td');
            const target = coordinates(cells[1]);
            const origin = coordinates(cells[2]);
            const analysisCell = cells[8];

            if (!target || !origin || !analysisCell) return;

            const badges = [];
            const colors = [];

            analysisCell.querySelectorAll('.village-analysis-badge').forEach((badge) => {
                const text = badge.textContent.trim();
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
        button.textContent = 'Zapisz analizy do gry';
        button.style.cssText = [
            'position:fixed', 'right:20px', 'bottom:20px', 'z-index:999999',
            'padding:10px 15px', 'border:1px solid #3e4147', 'border-radius:4px',
            'background:#2e7a2e', 'color:white', 'font-weight:bold', 'cursor:pointer'
        ].join(';');

        button.addEventListener('click', () => {
            const data = collectAnalyses();

            if (!data.length) {
                button.textContent = 'Brak analiz do zapisania';
                setTimeout(() => { button.textContent = 'Zapisz analizy do gry'; }, 3000);
                return;
            }

            GM_setValue(STORAGE_KEY, JSON.stringify(data));
            button.textContent = `Zapisano: ${data.length} ataków`;
            setTimeout(() => { button.textContent = 'Zapisz analizy do gry'; }, 4000);
        });

        document.body.appendChild(button);
    }

    function incomingRows() {
        return Array.from(document.querySelectorAll(
            '#incomings_table tbody tr, #incomings_table tr.nowrap'
        ));
    }

    function rowCoordinates(row) {
        const cells = row.querySelectorAll(':scope > td');
        let target = coordinates(cells[1]);
        let origin = coordinates(cells[2]);

        if (!target || !origin) {
            const all = [...(row.textContent || '').matchAll(/\b\d{1,3}\|\d{1,3}\b/g)]
                .map((match) => match[0]);
            target = target || all[0] || null;
            origin = origin || all[1] || null;
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
        if (!renameButton) return;

        renameButton.click();

        setTimeout(() => {
            const input = row.querySelector(
                'input[type="text"], input.quickedit-edit, input[name*="label"], input[name*="name"]'
            );
            if (!input) return;

            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            )?.set;

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
                key: 'Enter',
                code: 'Enter',
                bubbles: true
            }));
        }, 250);
    }

    function initPlemiona() {
        if (!isPlemiona || document.querySelector('#tcm-analyse-incomings')) return;

        const table = document.querySelector('#incomings_table');
        if (!table) return;

        const header = table.querySelector('thead tr') || table.querySelector('tr');
        const commandHeader = header?.querySelector('th');
        if (!commandHeader) return;

        const button = document.createElement('button');
        button.id = 'tcm-analyse-incomings';
        button.type = 'button';
        button.textContent = 'Analizuj';
        button.style.cssText = 'margin-left:8px;padding:3px 8px;cursor:pointer;font-weight:bold;';
        commandHeader.appendChild(button);

        button.addEventListener('click', () => {
            const data = readData();
            if (!data.length) {
                alert('Brak zapisanych analiz z TWDB. Najpierw zapisz analizy na stronie TWDB.');
                return;
            }

            let delay = 0;
            let count = 0;

            incomingRows().forEach((row) => {
                const { target, origin } = rowCoordinates(row);
                const match = data.find((item) => item.t === target && item.o === origin);
                if (!match || !match.a) return;

                const labelElement = findLabel(row);
                const current = labelElement ? labelElement.textContent.trim() : '';
                if (current.includes(match.a)) return;

                const clean = current
                    .replace(/\[[^\]]*]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                const newLabel = clean ? `${clean} ${match.a}` : match.a;

                setTimeout(() => renameCommand(row, newLabel), delay);
                delay += 1300;
                count += 1;
            });

            button.textContent = count ? `Zmieniono: ${count}` : 'Brak pasujących komend';
            setTimeout(() => { button.textContent = 'Analizuj'; }, 4000);
        });
    }

    function start() {
        if (!document.body) return;

        const observer = new MutationObserver(() => {
            if (isTWDatabase) initTWDatabase();
            if (isPlemiona) initPlemiona();
        });

        observer.observe(document.body, { childList: true, subtree: true });
        if (isTWDatabase) initTWDatabase();
        if (isPlemiona) initPlemiona();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
