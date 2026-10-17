/* tags.js — словники міток і імпорт щоденника з Notion (CSV).
   Мітки в базі зберігаються кодами (left, citramon…), підписи — тут. */
(function () {
  const T = {
    onset: { night: "Ніч", morning: "Ранок", day: "День", evening: "Вечір" },
    sides: { left: "Зліва", right: "Справа", forehead: "Лоб", temple: "Скроня", back: "Потилиця", eye: "Око / ніс", whole: "Уся голова" },
    meds: { "Цитрамон": "Цитрамон", "Темпалгін": "Темпалгін", "Ібупрофен": "Ібупрофен", "Парацетамол": "Парацетамол", "Інше": "Інше" },
    relief: { yes: "Так", partial: "Частково", no: "Ні" },
    triggers: {
      weather: "Погода", sleep: "Сон", stress: "Стрес", alarm: "Тривога / вибухи", alcohol: "Алкоголь",
      smoking: "Куріння", heat: "Спека", screen: "Екран", hunger: "Голод", coffee: "Кава", activity: "Навантаження",
    },
  };

  // Час доби за годиною: ніч 0–5, ранок 6–11, день 12–17, вечір 18–23.
  function onsetOf(date) {
    const h = date.getHours();
    return h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "day" : "evening";
  }
  const ONSET_HOUR = { night: 4, morning: 8, day: 14, evening: 20 };

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = []; let cell = ""; let q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  function toCSV(rows) {
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  }

  /* ---------- дати ---------- */
  const MONTHS = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    "січня": 0, "лютого": 1, "березня": 2, "квітня": 3, "травня": 4, "червня": 5, "липня": 6, "серпня": 7, "вересня": 8, "жовтня": 9, "листопада": 10, "грудня": 11 };
  // «October 14, 2026», «14 жовтня 2026», «2026-10-14», «14.10.2026», можливо з часом «10:30»
  function parseDate(s) {
    s = String(s || "").trim().toLowerCase();
    let y, m, d, hh = null, mm = 0;
    const tm = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
    if (tm) {
      hh = +tm[1]; mm = +tm[2];
      if (tm[3] === "pm" && hh < 12) hh += 12;
      if (tm[3] === "am" && hh === 12) hh = 0;
    }
    let r;
    if ((r = s.match(/(\d{4})-(\d{2})-(\d{2})/))) { y = +r[1]; m = +r[2] - 1; d = +r[3]; }
    else if ((r = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/))) { y = +r[3]; m = +r[2] - 1; d = +r[1]; }
    else if ((r = s.match(/([a-zа-яіїєґ]+)\s+(\d{1,2}),?\s+(\d{4})/i)) && r[1] in MONTHS) { y = +r[3]; m = MONTHS[r[1]]; d = +r[2]; }
    else if ((r = s.match(/(\d{1,2})\s+([a-zа-яіїєґ]+),?\s+(\d{4})/i)) && r[2] in MONTHS) { y = +r[3]; m = MONTHS[r[2]]; d = +r[1]; }
    else return null;
    return { y, m, d, hh, mm };
  }

  /* ---------- розбір тексту запису ---------- */
  const has = (t, ws) => ws.some((w) => t.includes(w));
  function tagText(text) {
    const t = " " + text.toLowerCase().replace(/ё/g, "е") + " ";
    const onset =
      has(t, ["вночі", "під ранок", "о шостій", "в 4 ранку", "6 ранку", "прокинувся від", "прокинулась від", "прокинулася від"]) ? "night" :
      has(t, ["зранку", "прокинувся", "прокинулась", "з самого ранку", "ранку"]) ? "morning" :
      has(t, ["обід", "в 11", "після обіду", "вдень", "в обід"]) ? "day" :
      has(t, ["звечора", "вечір", "вечора", "ввечері", "11 вечора"]) ? "evening" : null;
    const sides = [];
    if (t.includes("зліва")) sides.push("left");
    if (t.includes("справа")) sides.push("right");
    if (has(t, [" лоб", "лобі"])) sides.push("forehead");
    if (has(t, ["висок", "виску", "скрон"])) sides.push("temple");
    if (has(t, ["затил", "потилиц"])) sides.push("back");
    if (has(t, ["ніс", "носа", "переніс", "під оком"])) sides.push("eye");

    const meds = [];
    const cit = has(t, ["цитрамон", "цитамон"]) || (t.includes("таблетк") && !has(t, ["темпалг", "templeгін"]) && !has(t, ["поки не пив", "не знаю чи пити"]));
    const twice = has(t, ["2 цитрамон", "2 рази", "два цитрамон", "ще раз", "ще цитрамон", "другий цитрамон"]);
    const notYet = has(t, ["поки не пив", "не знаю чи пити", "буду пити", "думаю випити"]) && !has(t, ["випив", "пив "]);
    if (cit && !notYet) { meds.push({ name: "Цитрамон" }); if (twice) meds.push({ name: "Цитрамон" }); }
    if (has(t, ["темпалг", "templeгін"])) meds.push({ name: "Темпалгін" });

    let relief = null;
    if (meds.length) {
      if (has(t, ["не допомог", "не допоміг", "не пройшло"])) relief = "no";
      else if (has(t, ["не повністю", "трохи помог", "помогла трохи", "все одно", "ще болить", "досі болить", "заболіла знову"])) relief = "partial";
      else if (has(t, ["допоміг", "допомогло", "помогло", "попустило", "швидко допомогло", "пройшла"])) relief = "yes";
    }
    const triggers = [];
    if (has(t, ["дощ", "вітер", "вітрян", "погод", "туман", "смог", "прохолодн", "мрачн"])) triggers.push("weather");
    if (has(t, ["жарк", "спек", "перегрів"])) triggers.push("heat");
    if (has(t, ["спав", "виспав", "прокинутися", "заснув"])) triggers.push("sleep");
    if (has(t, ["нервув", "стрес"])) triggers.push("stress");
    if (has(t, ["вибух", "тривог"])) triggers.push("alarm");
    if (has(t, ["пива", "пиво", "вино", "метах", "алкогол"])) triggers.push("alcohol");
    if (has(t, ["курн", "курив"])) triggers.push("smoking");
    if (has(t, ["лате", "кава", "кав"])) triggers.push("coffee");
    return { onset, sides, meds, relief, triggers, nausea: has(t, ["тошн", "нудит", "нудот"]) };
  }

  const INTENSITY = { "слабкий": 3, "легкий": 3, "помірний": 5, "середній": 5, "сильний": 8, "дуже сильний": 9 };

  // Notion CSV → епізоди. Шукає колонки за назвою, порядок не важливий.
  function importNotion(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("Файл порожній або не CSV.");
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const find = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const iDate = find("дата", "date", "created");
    const iDesc = find("назва", "опис", "name", "title");
    const iInt = find("інтенсив", "сила", "intensity");
    const iNote = find("нотат", "notes", "note");
    if (iDate < 0 || iDesc < 0) throw new Error("Не знайшов колонки «Дата» і «Назва / Опис».");
    const out = [];
    for (const r of rows.slice(1)) {
      const dt = parseDate(r[iDate]);
      if (!dt) continue;
      const desc = (r[iDesc] || "").trim();
      const extra = iNote >= 0 ? (r[iNote] || "").trim() : "";
      const tags = tagText(desc + " " + extra);
      const hour = dt.hh != null ? dt.hh : ONSET_HOUR[tags.onset] ?? 12;
      const start = new Date(dt.y, dt.m, dt.d, hour, dt.hh != null ? dt.mm : 0);
      const iv = iInt >= 0 ? (r[iInt] || "").trim().toLowerCase() : "";
      const num = parseInt(iv, 10);
      out.push({
        started_at: start.toISOString(), ended_at: null,
        onset: tags.onset || onsetOf(start),
        intensity: Number.isFinite(num) ? Math.max(0, Math.min(10, num)) : INTENSITY[iv] ?? null,
        sides: tags.sides, meds: tags.meds.map((m) => ({ ...m, at: start.toISOString() })), relief: tags.relief,
        triggers: tags.triggers, nausea: tags.nausea,
        note: [desc, extra].filter(Boolean).join("\n\n") || null, source: "import",
      });
    }
    return out.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
  }

  window.Tags = { T, onsetOf, parseCSV, toCSV, parseDate, tagText, importNotion };
})();
