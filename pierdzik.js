// ==UserScript==
// @name         TW Profile Overlay FIXED
// @match        https://*.plemiona.pl/game.php?*screen=info_player*
// @grant        GM_xmlhttpRequest
// @connect      twdatabase.online
// ==/UserScript==

(function () {
    'use strict';

    console.log("🔥 Script start");

    function getPlayerId() {
        const url = new URL(window.location.href);
        const id = url.searchParams.get("id");
        console.log("ID:", id);
        return id;
    }

    function createOverlay(data) {
        console.log("Tworzę overlay", data);

        const box = document.createElement('div');
        box.style.position = "fixed";
        box.style.top = "200px";
        box.style.right = "20px";
        box.style.background = "black";
        box.style.color = "lime";
        box.style.padding = "10px";
        box.style.zIndex = 9999;

        box.innerHTML = `
            <b>TWDatabase</b><br>
            Ataki: ${data.attacks || "brak"}<br>
            Raporty: ${data.reports || "brak"}
        `;

        document.body.appendChild(box);
    }

    function fetchPlayerData(id) {
        console.log("Fetch ID:", id);

        GM_xmlhttpRequest({
            method: "GET",
            url: `https://twdatabase.online/api/player?id=${id}`,
            onload: function (res) {
                console.log("RESPONSE:", res.responseText);

                try {
                    const data = JSON.parse(res.responseText);
                    createOverlay(data);
                } catch (e) {
                    console.error("Błąd JSON:", e);
                }
            },
            onerror: function (err) {
                console.error("Błąd requesta:", err);
            }
        });
    }

    function init() {
        const id = getPlayerId();
        if (!id) {
            console.log("Brak ID ❌");
            return;
        }

        fetchPlayerData(id);
    }

    // 🔥 WAŻNE: opóźnienie bo DOM się ładuje dynamicznie
    setTimeout(init, 1000);

})();
