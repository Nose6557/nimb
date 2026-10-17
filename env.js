/* env.js — місце, дані довкілля і прогноз ризику.
   Дані по днях дає функція Supabase `env` (Open-Meteo + GFZ + NOAA).
   Кеш живе в браузері: історія тягнеться один раз, свіжі дні — кожні 3 години.

   Модель ризику (проста і прозора, бо записів мало):
   1. Базова частота p0 — частка днів з епізодом від першого запису до сьогодні.
   2. Для кожного фактора (тиск падає, магнітна буря…) рахуємо, як часто болить у дні з ним.
      Відношення до p0 — «у скільки разів частіше». Його стягуємо до загальновідомого
      значення (prior), поки днів з фактором мало, щоб один випадок не робив висновків.
   3. Ризик дня = p0 × добуток відношень присутніх факторів, де відношення > 1.
      Рівень: < 1.3× — низький, < 2× — середній, далі — високий. */
(function () {
  const cfg = window.NIMB_CONFIG || {};
  const LS_ENV = "nimb_env_v1";
  const DAY_MS = 864e5;
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const shift = (day, n) => { const d = new Date(day + "T12:00:00"); d.setDate(d.getDate() + n); return dayKey(d); };
  const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const FACTORS = [
    { id: "pdrop", label: "Тиск падає", prior: 1.5, test: (d) => d.pressure_delta != null && d.pressure_delta <= -4, hint: "середній тиск нижчий за вчорашній на 4 гПа і більше" },
    { id: "prise", label: "Тиск росте", prior: 1.2, test: (d) => d.pressure_delta != null && d.pressure_delta >= 4, hint: "середній тиск вищий за вчорашній на 4 гПа і більше" },
    { id: "tjump", label: "Різка зміна температури", prior: 1.3, test: (d) => d.temp_delta != null && Math.abs(d.temp_delta) >= 6, hint: "максимум відрізняється від вчорашнього на 6 °C і більше" },
    { id: "heat", label: "Спека", prior: 1.3, test: (d) => d.temp_max != null && d.temp_max >= 29, hint: "29 °C і вище" },
    { id: "rain", label: "Дощ", prior: 1.15, test: (d) => d.precip_sum != null && d.precip_sum >= 2, hint: "2 мм опадів і більше" },
    { id: "wind", label: "Сильний вітер", prior: 1.15, test: (d) => d.wind_max != null && d.wind_max >= 20, hint: "середній вітер від 20 км/год" },
    { id: "humid", label: "Висока вологість", prior: 1.1, test: (d) => d.humidity_mean != null && d.humidity_mean >= 85, hint: "середня вологість від 85%" },
    { id: "kp", label: "Магнітна буря", prior: 1.2, test: (d) => d.kp_max != null && d.kp_max >= 5, hint: "індекс Kp 5 і вище" },
    { id: "pm", label: "Брудне повітря", prior: 1.2, test: (d) => d.pm25_mean != null && d.pm25_mean >= 25, hint: "PM2.5 від 25 мкг/м³ за добу" },
  ];
  const SHRINK = 12; // скільки «уявних днів» тягнуть оцінку до prior

  /* ---------- місце ---------- */
  async function place(prefs) {
    if (prefs.location_mode === "manual" && prefs.place) return { ...prefs.place, how: "manual" };
    const cached = rd("nimb_geo", null);
    const fresh = cached && Date.now() - cached.at < 6 * 3600e3;
    if (fresh) return { ...cached, how: "auto" };
    const got = await new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
        () => res(null), { timeout: 8000, maximumAge: 6 * 3600e3 });
    });
    if (got) { const g = { ...got, name: null, at: Date.now() }; wr("nimb_geo", g); return { ...g, how: "auto" }; }
    if (cached) return { ...cached, how: "auto" };
    return { ...cfg.DEFAULT_PLACE, how: "default" };
  }
  async function searchCity(q) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=uk&format=json`);
    if (!r.ok) throw new Error("Пошук міста недоступний");
    const j = await r.json();
    return (j.results || []).map((x) => ({ name: x.name, region: [x.admin1, x.country].filter(Boolean).join(", "), lat: Math.round(x.latitude * 100) / 100, lon: Math.round(x.longitude * 100) / 100 }));
  }

  /* ---------- дані довкілля ---------- */
  const keyOf = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  async function fetchRange(p, start, end) {
    const u = `${cfg.ENV_URL}?lat=${p.lat}&lon=${p.lon}&start=${start}&end=${end}`;
    const r = await fetch(u);
    if (!r.ok) throw new Error("env " + r.status);
    return r.json();
  }
  // Повертає { days: {day: row}, errors[] } для місця від `since` до +3 днів.
  async function load(p, since) {
    const all = rd(LS_ENV, {});
    const k = keyOf(p);
    const c = all[k] || { days: {}, have_from: null, recent_at: 0 };
    const today = dayKey(new Date());
    const end = shift(today, 3);
    const errors = [];
    const jobs = [];
    // історія: дотягуємо, якщо треба раніше за те, що вже є
    if (since && (!c.have_from || since < c.have_from)) {
      const hEnd = c.have_from ? shift(c.have_from, -1) : shift(today, -8);
      if (since <= hEnd) jobs.push(fetchRange(p, since, hEnd).then((j) => { j.days.forEach((d) => (c.days[d.day] = d)); (j.errors || []).forEach((e) => errors.push(e)); c.have_from = since; }));
    }
    // свіжі дні й прогноз
    if (Date.now() - c.recent_at > 3 * 3600e3 || !c.days[end]) {
      jobs.push(fetchRange(p, shift(today, -7), end).then((j) => { j.days.forEach((d) => (c.days[d.day] = d)); (j.errors || []).forEach((e) => errors.push(e)); c.recent_at = Date.now(); if (!c.have_from) c.have_from = shift(today, -7); }));
    }
    const res = await Promise.allSettled(jobs);
    res.forEach((r) => { if (r.status === "rejected") errors.push(String(r.reason)); });
    all[k] = c;
    wr(LS_ENV, all);
    return { days: c.days, errors };
  }

  /* ---------- аналіз і ризик ---------- */
  function analyze(episodes, envDays) {
    const epDays = new Set(episodes.map((e) => dayKey(new Date(e.started_at))));
    const today = dayKey(new Date());
    const first = episodes.length ? [...epDays].sort()[0] : null;
    const rows = [];
    if (first) for (let d = first; d <= today; d = shift(d, 1)) if (envDays[d]) rows.push({ day: d, env: envDays[d], ep: epDays.has(d) });
    const n = rows.length;
    const e = rows.filter((r) => r.ep).length;
    const p0 = n ? Math.max(e / n, 0.01) : 0.08;
    const factors = FACTORS.map((f) => {
      const with_ = rows.filter((r) => f.test(r.env));
      const nf = with_.length;
      const ef = with_.filter((r) => r.ep).length;
      const rate = (ef + SHRINK * p0 * f.prior) / (nf + SHRINK);
      const rr = rate / p0;
      const raw = nf ? ef / nf / p0 : null;
      const strength = nf >= 10 && ef >= 3 ? "enough" : nf >= 4 ? "some" : "little";
      return { ...f, nf, ef, rr, raw, strength };
    });
    return { n, e, p0, factors, analyzed: n >= 30 };
  }
  function riskFor(dayEnv, model) {
    if (!dayEnv) return null;
    const present = model.factors.filter((f) => f.test(dayEnv));
    const up = present.filter((f) => f.rr > 1.05).sort((a, b) => b.rr - a.rr);
    const mult = Math.min(up.reduce((m, f) => m * f.rr, 1), 4);
    const level = mult < 1.3 ? "low" : mult < 2 ? "mid" : "high";
    return { level, mult, chance: Math.min(model.p0 * mult, 0.95), factors: up, present };
  }
  const LEVEL = { low: "Низький", mid: "Середній", high: "Високий" };

  window.Env = { FACTORS, LEVEL, place, searchCity, load, analyze, riskFor, dayKey, shift };
})();
