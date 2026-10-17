/* app.js — екрани, навігація і відмальовування. Дані — тільки через Store. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const { T } = Tags;
  const dayKey = Env.dayKey, shift = Env.shift;
  const S = { episodes: [], okDays: [], prefs: Store.prefs(), place: null, env: {}, envErrors: [], model: null, range: 365 };

  /* ---------- дрібні помічники ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const toLocalInput = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
  const hm = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtN = (x, k = 0) => Number(x).toLocaleString("uk-UA", { maximumFractionDigits: k, minimumFractionDigits: k });
  const MON_FULL = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
  const MON_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
  const WD = ["Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота", "Неділя"];
  const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  const durText = (ms) => { const m = Math.max(0, Math.round(ms / 6e4)); const h = Math.floor(m / 60); return h ? `${h} год ${m % 60} хв` : `${m} хв`; };
  function toast(text) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = text; t.setAttribute("role", "status");
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  function busy(btn, on) { btn.classList.toggle("loading", on); btn.disabled = on; }
  function fail(e) { console.error(e); toast(e && e.message ? e.message : "Щось пішло не так"); }
  const today = () => dayKey(new Date());

  /* ---------- тема ---------- */
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.dataset.theme = t; else delete root.dataset.theme;
    requestAnimationFrame(() => { $('meta[name="theme-color"]').content = getComputedStyle(document.body).backgroundColor; });
    $$("#theme-seg .seg").forEach((b) => b.classList.toggle("active", b.dataset.themeV === (t || "system")));
  }
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme(S.prefs.theme));

  /* ---------- навігація ---------- */
  function go(name) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === "screen-" + name));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.go === name));
    const app = name !== "auth";
    $("#tabs").hidden = !app; document.body.classList.toggle("no-tabs", !app);
    if (name === "stats") renderStats();
    window.scrollTo(0, 0);
  }
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

  /* ---------- вхід ---------- */
  let authTab = "in";
  $$("[data-authtab]").forEach((b) => b.addEventListener("click", () => {
    authTab = b.dataset.authtab;
    $$("[data-authtab]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
    $("#auth-go").textContent = authTab === "in" ? "Увійти" : "Створити акаунт";
    $("#auth-pass").autocomplete = authTab === "in" ? "current-password" : "new-password";
    $("#auth-msg").hidden = true;
  }));
  function authMsg(text, ok) { const m = $("#auth-msg"); m.textContent = text; m.className = "note " + (ok ? "ok" : "error"); m.hidden = false; }
  $("#auth-go").addEventListener("click", async () => {
    const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg("Перевір адресу пошти.");
    if (pass.length < 6) return authMsg("Пароль — щонайменше 6 символів.");
    const btn = $("#auth-go"); busy(btn, true);
    try {
      if (authTab === "in") await Store.signIn(email, pass);
      else { const r = await Store.signUp(email, pass); if (r.needsConfirm) { busy(btn, false); return authMsg("Лист з підтвердженням уже на пошті. Відкрий посилання й увійди.", true); } }
      const moved = await Store.migrateGuest().catch(() => 0);
      if (moved) toast(`Перенесено записів з браузера: ${moved}`);
      await enter();
    } catch (e) {
      authMsg(/invalid login/i.test(e.message) ? "Невірна пошта або пароль." : /not confirmed/i.test(e.message) ? "Спершу підтвердь пошту за посиланням з листа." : e.message);
    } finally { busy(btn, false); }
  });
  $("#auth-guest").addEventListener("click", () => { Store.useGuest(); enter(); });

  /* ---------- завантаження ---------- */
  async function enter() {
    go("home");
    S.prefs = await Store.pullPrefs().catch(() => Store.prefs());
    applyTheme(S.prefs.theme);
    renderSettings();
    await reload();
    loadEnv();
  }
  async function reload() {
    try { [S.episodes, S.okDays] = await Promise.all([Store.list(), Store.okDays()]); }
    catch (e) { fail(e); }
    renderHome(); renderHistory();
    if (Object.keys(S.env).length) { S.model = Env.analyze(S.episodes, S.env); renderRisk(); }
    if ($("#screen-stats").classList.contains("active")) renderStats();
  }
  async function loadEnv() {
    try {
      S.place = await Env.place(S.prefs);
      renderLocNow();
      const first = S.episodes.length ? dayKey(new Date(S.episodes[S.episodes.length - 1].started_at)) : shift(today(), -30);
      const r = await Env.load(S.place, first);
      S.env = r.days; S.envErrors = r.errors;
    } catch (e) { S.envErrors = [String(e)]; }
    S.model = Env.analyze(S.episodes, S.env);
    renderRisk();
    if ($("#screen-stats").classList.contains("active")) renderFactors();
  }

  /* ---------- головна ---------- */
  function activeEpisode() {
    const e = S.episodes.find((x) => !x.ended_at);
    return e && Date.now() - new Date(e.started_at) < 48 * 3600e3 ? e : null;
  }
  let timerId = null;
  function renderHome() {
    const d = new Date();
    $("#home-date").textContent = `${WD[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
    const a = activeEpisode();
    const slot = $("#active-slot"); slot.innerHTML = "";
    clearInterval(timerId);
    $("#btn-pain").hidden = !!a;
    if (a) {
      const c = document.createElement("div"); c.className = "card active-ep";
      const meds = a.meds || [];
      const lastMed = meds.length ? Math.max(...meds.map((m) => +new Date(m.at || a.started_at))) : 0;
      c.innerHTML = `
        <div class="card-head"><span class="eyebrow">Болить зараз</span><span class="small muted">з ${hm(a.started_at)}</span></div>
        <p class="timer" id="t-elapsed"></p>
        <p class="small muted" id="t-meds"></p>
        <div class="row"><button class="btn ghost small" id="a-med">+ Цитрамон</button><button class="btn ghost small" id="a-more">Деталі</button></div>
        <div class="field" id="a-relief" hidden><span>Таблетка допомогла?</span><div class="chips"></div></div>
        <button class="btn primary" id="a-end">Минуло</button>`;
      slot.appendChild(c);
      const tick = () => { const el = $("#t-elapsed"); if (el) el.textContent = durText(Date.now() - new Date(a.started_at)); };
      tick(); timerId = setInterval(tick, 30000);
      $("#t-meds").textContent = meds.length ? "Таблетки: " + meds.map((m) => `${m.name} о ${hm(m.at || a.started_at)}`).join(", ") : "Таблетку не пив";
      if (meds.length && !a.relief && Date.now() - lastMed > 40 * 6e4) {
        const box = $("#a-relief"); box.hidden = false;
        Object.entries(T.relief).forEach(([k, v]) => {
          const b = document.createElement("button"); b.className = "chip"; b.textContent = v;
          b.onclick = async () => { await saveEp(a.id, { ...a, relief: k }); toast("Записав"); };
          box.querySelector(".chips").appendChild(b);
        });
      }
      $("#a-med").onclick = async () => { await saveEp(a.id, { ...a, meds: [...meds, { name: "Цитрамон", at: new Date().toISOString() }] }); toast("Цитрамон записано"); };
      $("#a-more").onclick = () => openSheet(a);
      $("#a-end").onclick = async () => { await saveEp(a.id, { ...a, ended_at: new Date().toISOString() }); toast("Добре, що минуло"); };
    }
    const t = today();
    const hadToday = S.episodes.some((e) => dayKey(new Date(e.started_at)) === t);
    const okb = $("#btn-ok");
    okb.disabled = hadToday;
    okb.textContent = S.okDays.includes(t) ? "✓ Сьогодні без болю" : "Сьогодні без болю";
    okb.style.opacity = hadToday ? ".45" : "";
    renderList($("#recent-list"), S.episodes.slice(0, 3), true);
  }
  $("#btn-pain").addEventListener("click", async () => {
    const now = new Date();
    try {
      const e = await Store.add({ started_at: now.toISOString(), onset: Tags.onsetOf(now) });
      if (S.okDays.includes(today())) await Store.unmarkOk(today());
      await reload();
      openSheet(e, { title: "Болить зараз" });
    } catch (err) { fail(err); }
  });
  $("#btn-ok").addEventListener("click", async () => {
    const t = today();
    try { if (S.okDays.includes(t)) await Store.unmarkOk(t); else { await Store.markOk(t); toast("Відмічено. Такі дні роблять прогноз точнішим"); } await reload(); }
    catch (e) { fail(e); }
  });
  $("#btn-past").addEventListener("click", () => openSheet(null, { title: "Минулий епізод" }));

  function renderRisk() {
    const card = $("#risk-card");
    const m = S.model, t = today();
    $("#risk-place").textContent = S.place ? (S.place.name || "Твоє місце") + (S.place.how === "default" ? " · за замовчуванням" : "") : "";
    const r = Env.riskFor(S.env[shift(t, 1)], m);
    const why = $("#risk-why"), chips = $("#risk-factors"), days = $("#risk-days"), line = $("#env-line"), note = $("#risk-note");
    chips.innerHTML = ""; days.innerHTML = ""; line.innerHTML = "";
    if (!r) {
      card.dataset.level = ""; $("#risk-level").textContent = "—";
      why.textContent = S.envErrors.length ? "Не вдалося завантажити погоду. Перевір інтернет." : "Завантажую погоду…";
      note.textContent = ""; return;
    }
    card.dataset.level = r.level;
    $("#risk-level").textContent = Env.LEVEL[r.level];
    why.textContent = r.level !== "low"
      ? `У такі дні болить у ${fmtN(r.mult, 1)} раза частіше, ніж зазвичай.`
      : r.factors.length ? "Ризик майже такий, як у звичайний день." : "Нічого незвичного в погоді на завтра.";
    r.factors.forEach((f) => { const c = document.createElement("span"); c.className = "chip static"; c.textContent = f.label; chips.appendChild(c); });
    [0, 1, 2].forEach((i) => {
      const k = shift(t, i), rr = Env.riskFor(S.env[k], m);
      const d = document.createElement("div"); d.className = "day3"; if (rr) d.dataset.level = rr.level;
      const dt = new Date(k + "T12:00:00");
      d.innerHTML = `<b>${i === 0 ? "Сьогодні" : i === 1 ? "Завтра" : WD_SHORT[(dt.getDay() + 6) % 7] + ", " + dt.getDate()}</b><span class="lv"></span>`;
      d.querySelector(".lv").textContent = rr ? Env.LEVEL[rr.level] : "—";
      days.appendChild(d);
    });
    const e = S.env[shift(t, 1)];
    const bits = [];
    if (e.pressure_mean != null) bits.push(["Тиск", `${fmtN(e.pressure_mean)} гПа` + (e.pressure_delta != null ? ` (${e.pressure_delta > 0 ? "+" : ""}${fmtN(e.pressure_delta, 1)})` : "")]);
    if (e.temp_max != null) bits.push(["Макс.", `${fmtN(e.temp_max)}°`]);
    if (e.kp_max != null) bits.push(["Kp", fmtN(e.kp_max, 1)]);
    if (e.pm25_mean != null) bits.push(["PM2.5", fmtN(e.pm25_mean)]);
    bits.forEach(([k, v]) => { const s = document.createElement("span"); s.append(k + " "); const b = document.createElement("b"); b.textContent = v; s.appendChild(b); line.appendChild(s); });
    note.textContent = (m.analyzed
      ? `Модель навчена на ${m.n} днях, з них з болем — ${m.e}.`
      : "Поки мало днів з погодою — беру загальновідомі зв'язки і поступово підлаштовуюсь під тебе.")
      + (S.envErrors.length ? " Частина даних тимчасово недоступна." : "");
  }

  /* ---------- список записів ---------- */
  function epTitle(e) {
    const bits = [T.onset[e.onset] || "Біль"];
    if (e.meds && e.meds.length) bits.push(e.meds.length > 1 ? `${e.meds.length} таблетки` : e.meds[0].name);
    return bits.join(" · ");
  }
  function epSub(e) {
    if (e.note) return e.note.split("\n")[0];
    const t = (e.triggers || []).map((x) => T.triggers[x] || x).join(", ");
    return t || (e.ended_at ? durText(new Date(e.ended_at) - new Date(e.started_at)) : "");
  }
  function renderList(box, items, compact) {
    box.innerHTML = "";
    if (!items.length) { box.innerHTML = `<p class="empty">${compact ? "Поки немає записів. Коли заболить — тисни «Болить»." : "Нічого не знайшов"}</p>`; return; }
    items.forEach((e) => {
      const d = new Date(e.started_at);
      const b = document.createElement("button"); b.className = "item";
      b.innerHTML = `<span class="date"><b></b><span></span></span><span class="what"><b></b><p></p></span><span class="int"></span>`;
      b.querySelector(".date b").textContent = d.getDate();
      b.querySelector(".date span").textContent = MON_SHORT[d.getMonth()];
      b.querySelector(".what b").textContent = epTitle(e);
      b.querySelector(".what p").textContent = epSub(e);
      const i = b.querySelector(".int");
      if (e.intensity != null) { i.textContent = e.intensity; i.dataset.i = ""; i.style.setProperty("--i", e.intensity); i.setAttribute("aria-label", "Сила " + e.intensity); }
      else { i.textContent = "–"; i.setAttribute("aria-label", "Сила не вказана"); }
      b.onclick = () => openSheet(e);
      box.appendChild(b);
    });
  }

  /* ---------- історія ---------- */
  function renderHistory() {
    const q = $("#hist-q").value.trim().toLowerCase();
    const items = S.episodes.filter((e) => !q || [e.note, epTitle(e), ...(e.triggers || []).map((x) => T.triggers[x])].join(" ").toLowerCase().includes(q));
    $("#hist-count").textContent = S.episodes.length ? `${S.episodes.length} записів` : "";
    const box = $("#hist-list"); box.innerHTML = "";
    if (!items.length) { box.innerHTML = `<p class="empty">${S.episodes.length ? "Нічого не знайшов" : "Поки немає записів. Можна імпортувати щоденник у Налаштуваннях."}</p>`; return; }
    let cur = null, list = null;
    items.forEach((e) => {
      const d = new Date(e.started_at), k = d.getFullYear() + "-" + d.getMonth();
      if (k !== cur) {
        cur = k;
        const n = items.filter((x) => { const y = new Date(x.started_at); return y.getFullYear() + "-" + y.getMonth() === k; }).length;
        const h = document.createElement("p"); h.className = "month-h"; h.textContent = `${MON_FULL[d.getMonth()]} ${d.getFullYear()} · ${n}`;
        list = document.createElement("div"); list.className = "list";
        box.append(h, list);
      }
      const tmp = document.createElement("div"); renderList(tmp, [e]); list.appendChild(tmp.firstChild);
    });
  }
  $("#hist-q").addEventListener("input", renderHistory);

  /* ---------- лист запису ---------- */
  const sheet = $("#ep-sheet");
  let editing = null, form = null, intTouched = false;
  function chipGroup(name, labels, opts = {}) {
    const box = $(`[data-group="${name}"]`, sheet); box.innerHTML = "";
    Object.entries(labels).forEach(([k, v]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.dataset.k = k; b.textContent = v;
      const paint = () => {
        if (name === "meds") { const n = form.meds.filter((m) => m.name === k).length; b.classList.toggle("on", n > 0); b.textContent = n > 1 ? `${v} ×${n}` : v; }
        else if (opts.single) b.classList.toggle("on", form[name] === k);
        else b.classList.toggle("on", form[name].includes(k));
        b.setAttribute("aria-pressed", b.classList.contains("on"));
      };
      b.onclick = () => {
        if (name === "meds") {
          const n = form.meds.filter((m) => m.name === k).length;
          if (n >= 2) form.meds = form.meds.filter((m) => m.name !== k);
          else form.meds.push({ name: k, at: new Date().toISOString() });
          $("#ep-relief-f").hidden = !form.meds.length;
        } else if (opts.single) form[name] = form[name] === k ? null : k;
        else form[name] = form[name].includes(k) ? form[name].filter((x) => x !== k) : [...form[name], k];
        $$(".chip", box).forEach((c) => c._paint());
      };
      b._paint = paint; paint(); box.appendChild(b);
    });
  }
  function openSheet(e, opt = {}) {
    editing = e && e.id ? e : null;
    const now = new Date();
    form = {
      started_at: e ? e.started_at : now.toISOString(), ended_at: e ? e.ended_at : null,
      intensity: e ? e.intensity : null, sides: [...((e && e.sides) || [])], meds: ((e && e.meds) || []).map((m) => ({ ...m })),
      relief: e ? e.relief : null, triggers: [...((e && e.triggers) || [])], nausea: !!(e && e.nausea), note: (e && e.note) || "",
      onset: e ? e.onset : null, source: e ? e.source : "app",
    };
    $("#ep-title").textContent = opt.title || (editing ? `${new Date(form.started_at).getDate()} ${MON_SHORT[new Date(form.started_at).getMonth()]} ${new Date(form.started_at).getFullYear()}` : "Запис");
    $("#ep-start").value = toLocalInput(form.started_at);
    $("#ep-end").value = toLocalInput(form.ended_at);
    intTouched = form.intensity != null;
    $("#ep-int").value = form.intensity ?? 3;
    $("#ep-int-v").textContent = form.intensity ?? "—";
    $("#ep-nausea").checked = form.nausea;
    $("#ep-note").value = form.note;
    chipGroup("sides", T.sides); chipGroup("meds", T.meds); chipGroup("relief", T.relief, { single: true }); chipGroup("triggers", T.triggers);
    $("#ep-relief-f").hidden = !form.meds.length;
    $("#ep-del").hidden = !editing;
    sheet.showModal();
  }
  $("#ep-int").addEventListener("input", (ev) => { intTouched = true; $("#ep-int-v").textContent = ev.target.value; });
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog.sheet").forEach((d) => d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }));
  async function saveEp(id, data) {
    try { await Store.update(id, data); await reload(); } catch (e) { fail(e); }
  }
  $("#ep-save").addEventListener("click", async () => {
    const start = fromLocalInput($("#ep-start").value) || new Date().toISOString();
    let end = fromLocalInput($("#ep-end").value);
    if (end && end < start) return toast("Кінець раніше за початок");
    const data = {
      ...form, started_at: start, ended_at: end,
      onset: editing && editing.started_at === start && form.onset ? form.onset : Tags.onsetOf(new Date(start)),
      intensity: intTouched ? Number($("#ep-int").value) : form.intensity,
      nausea: $("#ep-nausea").checked, note: $("#ep-note").value.trim(),
    };
    if (!data.meds.length) data.relief = null;
    const btn = $("#ep-save"); busy(btn, true);
    try {
      if (editing) await Store.update(editing.id, data); else await Store.add(data);
      const d = dayKey(new Date(start)); if (S.okDays.includes(d)) await Store.unmarkOk(d);
      sheet.close(); await reload(); toast("Збережено");
    } catch (e) { fail(e); } finally { busy(btn, false); }
  });
  $("#ep-del").addEventListener("click", async () => {
    if (!editing || !confirm("Видалити цей запис?")) return;
    try { await Store.remove(editing.id); sheet.close(); await reload(); toast("Видалено"); } catch (e) { fail(e); }
  });

  /* ---------- статистика ---------- */
  $$("#stats-range .seg").forEach((b) => b.addEventListener("click", () => {
    S.range = +b.dataset.range;
    $$("#stats-range .seg").forEach((x) => x.classList.toggle("active", x === b));
    renderStats();
  }));
  function inRange(e) { return !S.range || Date.now() - new Date(e.started_at) <= S.range * 864e5; }
  function kpi(label, value, sub, cls) {
    const d = document.createElement("div"); d.className = "stat";
    d.innerHTML = `<span class="stat-lab"></span><span class="stat-num"></span><span class="stat-sub"></span>`;
    d.children[0].textContent = label; d.children[1].textContent = value; d.children[2].textContent = sub || ""; if (cls) d.children[2].classList.add(cls);
    return d;
  }
  function renderStats() {
    const all = S.episodes, eps = all.filter(inRange);
    const box = $("#kpis"); box.innerHTML = "";
    const now = Date.now();
    const lastN = (a, b) => all.filter((e) => { const x = now - new Date(e.started_at); return x >= a * 864e5 && x < b * 864e5; });
    const c30 = lastN(0, 30).length, p30 = lastN(30, 60).length;
    const spanDays = eps.length ? Math.max(30, (now - new Date(eps[eps.length - 1].started_at)) / 864e5) : 30;
    const days = [...new Set(all.map((e) => dayKey(new Date(e.started_at))))].sort();
    const gaps = days.slice(1).map((d, i) => (new Date(d) - new Date(days[i])) / 864e5).sort((a, b) => a - b);
    const med = gaps.length ? (gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) : null;
    const medDays30 = new Set(lastN(0, 30).filter((e) => e.meds && e.meds.length).map((e) => dayKey(new Date(e.started_at)))).size;
    const rel = eps.filter((e) => e.relief); const relYes = rel.filter((e) => e.relief === "yes").length;
    const ints = eps.filter((e) => e.intensity != null);
    box.append(
      kpi("Епізодів", fmtN(eps.length), `≈ ${fmtN(eps.length / (spanDays / 30.4), 1)} на місяць`),
      kpi("За 30 днів", fmtN(c30), p30 ? `${c30 - p30 > 0 ? "+" : ""}${c30 - p30} до попередніх 30` : "", c30 > p30 ? "up" : c30 < p30 ? "down" : ""),
      kpi("Пауза, медіана", med != null ? fmtN(med) : "—", "днів між епізодами"),
      kpi("Дні з таблеткою", fmtN(medDays30), "за 30 днів"),
      kpi("Таблетка допомогла", rel.length ? fmtN((relYes / rel.length) * 100) + "%" : "—", rel.length ? `з ${rel.length} відміток` : "відмічай у записі"),
      kpi("Сила, середня", ints.length ? fmtN(ints.reduce((s, e) => s + e.intensity, 0) / ints.length, 1) : "—", ints.length ? `з 10 · ${ints.length} записів` : ""),
    );
    const w = $("#med-warn");
    w.hidden = medDays30 < 10;
    w.textContent = "10 і більше днів з таблеткою за місяць. Часті знеболювальні самі можуть викликати головний біль — варто обговорити це з лікарем.";

    // по місяцях
    const months = [];
    if (eps.length) {
      const first = new Date(eps[eps.length - 1].started_at);
      const start = S.range ? new Date(Math.max(+first, now - S.range * 864e5)) : first;
      let y = start.getFullYear(), m = start.getMonth();
      const end = new Date();
      while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
        const key = `${y}-${pad(m + 1)}`;
        const es = eps.filter((e) => dayKey(new Date(e.started_at)).startsWith(key));
        months.push({ key, a: es.length, b: new Set(es.filter((e) => e.meds && e.meds.length).map((e) => dayKey(new Date(e.started_at)))).size });
        if (++m > 11) { m = 0; y++; }
      }
    }
    Charts.months($("#chart-months"), months);

    // календар
    const lv = new Map();
    S.okDays.forEach((d) => lv.set(d, "ok"));
    all.forEach((e) => {
      const k = dayKey(new Date(e.started_at)); const i = e.intensity;
      const c = i == null || i <= 3 ? "l1" : i <= 6 ? "l2" : "l3";
      const prev = lv.get(k); const rank = { ok: 0, l1: 1, l2: 2, l3: 3 };
      if (!prev || rank[c] > rank[prev]) lv.set(k, c);
    });
    Charts.heat($("#heat"), lv, S.range === 90 ? 13 : 53, dayKey);

    // розбивки
    const cnt = (fn) => { const m = {}; eps.forEach((e) => fn(e).forEach((k) => (m[k] = (m[k] || 0) + 1))); return m; };
    const on = cnt((e) => [e.onset || "none"]);
    Charts.hbars($("#b-onset"), [...Object.entries(T.onset).map(([k, v]) => ({ label: v, n: on[k] || 0 })), { label: "Не вказано", n: on.none || 0, muted: true }].filter((r) => r.n || !r.muted));
    const tr = cnt((e) => (e.triggers && e.triggers.length ? e.triggers : ["none"]));
    Charts.hbars($("#b-trig"), [...Object.entries(T.triggers).map(([k, v]) => ({ label: v, n: tr[k] || 0 })).filter((r) => r.n).sort((a, b) => b.n - a.n), { label: "Не згадано", n: tr.none || 0, muted: true }]);
    const wd = cnt((e) => [String((new Date(e.started_at).getDay() + 6) % 7)]);
    Charts.hbars($("#b-week"), WD.map((v, i) => ({ label: v, n: wd[i] || 0 })));
    const md = {}; eps.forEach((e) => (e.meds || []).forEach((m) => (md[m.name] = (md[m.name] || 0) + 1)));
    const noMed = eps.filter((e) => !e.meds || !e.meds.length).length;
    Charts.hbars($("#b-meds"), [...Object.entries(md).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k, n })), { label: "Без таблетки", n: noMed, muted: true }]);
    renderFactors();
  }
  function renderFactors() {
    const box = $("#factors"), note = $("#factors-note"); box.innerHTML = "";
    const m = S.model;
    if (!m || !Object.keys(S.env).length) { note.textContent = S.envErrors.length ? "Погода зараз недоступна." : "Завантажую погоду за дні з записами…"; return; }
    if (!m.n) { note.textContent = "Додай записи — і тут з'явиться порівняння з погодою."; return; }
    note.textContent = `Звичайний день: болить у ${fmtN(m.p0 * 100)}% днів. Порівнюю ${m.n} днів з погодою, з них з болем — ${m.e}. «×1,5» — болить у півтора раза частіше.`;
    m.factors.slice().sort((a, b) => b.rr - a.rr).forEach((f) => {
      const d = document.createElement("div"); d.className = "factor";
      const x = f.rr >= 1.15 ? "up" : "flat";
      d.innerHTML = `<b></b><span class="x ${x}"></span><span class="d"></span>`;
      d.children[0].textContent = f.label;
      d.children[1].textContent = "×" + fmtN(f.rr, 1);
      d.children[2].textContent = (f.nf ? `Болить у ${f.ef} з ${f.nf} таких днів. ` : "Таких днів ще не було. ") +
        (f.strength === "little" ? "Даних мало — оцінка близька до загальновідомої. " : f.strength === "some" ? "Даних поки небагато. " : "") + `Умова: ${f.hint}.`;
      box.appendChild(d);
    });
  }

  /* ---------- налаштування ---------- */
  function renderSettings() {
    applyTheme(S.prefs.theme);
    $$("#loc-seg .seg").forEach((b) => b.classList.toggle("active", b.dataset.loc === S.prefs.location_mode));
    $("#loc-manual").hidden = S.prefs.location_mode !== "manual";
    $("#acc-who").textContent = Store.mode === "supabase" ? `Ти увійшов як ${Store.user.email}. Записи синхронізуються між пристроями.` : "Гостьовий режим: записи лише в цьому браузері. Створи акаунт, щоб не втратити їх — вони перенесуться.";
    $("#acc-btn").textContent = Store.mode === "supabase" ? "Вийти" : "Увійти або створити акаунт";
    $("#ver").textContent = `Версія ${NIMB_VERSION}.`;
  }
  function renderLocNow() {
    const p = S.place; if (!p) return;
    $("#loc-now").textContent = p.how === "manual" ? `Зараз: ${p.name}` : p.how === "auto" ? `Зараз: за геолокацією (${fmtN(p.lat, 2)}, ${fmtN(p.lon, 2)})` : `Геолокація недоступна — беру ${p.name}. Дозволь доступ до місця або задай місто вручну.`;
  }
  $$("#theme-seg .seg").forEach((b) => b.addEventListener("click", async () => { S.prefs = await Store.setPrefs({ theme: b.dataset.themeV }); applyTheme(S.prefs.theme); }));
  $$("#loc-seg .seg").forEach((b) => b.addEventListener("click", async () => {
    S.prefs = await Store.setPrefs({ location_mode: b.dataset.loc });
    renderSettings();
    if (b.dataset.loc === "auto" || S.prefs.place) loadEnv(); else $("#city-q").focus();
  }));
  let cityT = null;
  $("#city-q").addEventListener("input", (ev) => {
    clearTimeout(cityT);
    const q = ev.target.value.trim(); const box = $("#city-results");
    if (q.length < 2) { box.innerHTML = ""; return; }
    cityT = setTimeout(async () => {
      try {
        const res = await Env.searchCity(q); box.innerHTML = "";
        if (!res.length) box.innerHTML = '<p class="small muted">Не знайшов</p>';
        res.forEach((c) => {
          const b = document.createElement("button"); b.className = "chip"; b.textContent = `${c.name}${c.region ? ", " + c.region : ""}`;
          b.onclick = async () => { S.prefs = await Store.setPrefs({ location_mode: "manual", place: { name: c.name, lat: c.lat, lon: c.lon } }); box.innerHTML = ""; ev.target.value = ""; renderSettings(); toast(`Місце: ${c.name}`); loadEnv(); };
          box.appendChild(b);
        });
      } catch (e) { box.innerHTML = '<p class="small muted">Пошук недоступний</p>'; }
    }, 350);
  });
  $("#acc-btn").addEventListener("click", async () => {
    if (Store.mode === "supabase" && !confirm("Вийти з акаунта?")) return;
    await Store.signOut();
    S.episodes = []; S.okDays = [];
    go("auth");
  });

  /* ---------- імпорт ---------- */
  let pending = [];
  $("#import-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    try {
      const rows = Tags.importNotion(await f.text());
      const have = new Set(S.episodes.map((e) => dayKey(new Date(e.started_at))));
      pending = rows.map((r) => ({ ...r, dup: have.has(dayKey(new Date(r.started_at))) }));
      const fresh = pending.filter((r) => !r.dup).length;
      $("#imp-sum").textContent = `Знайшов ${pending.length} записів. Нових: ${fresh}.` + (pending.length - fresh ? ` На ${pending.length - fresh} дат вже є запис — їх пропущу.` : "");
      const tb = $("#imp-rows"); tb.innerHTML = "";
      pending.slice().reverse().forEach((r) => {
        const tr = document.createElement("tr"); if (r.dup) tr.className = "dup";
        const d = new Date(r.started_at);
        [`${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`, T.onset[r.onset] || "—", r.intensity ?? "—", r.meds.map((m) => m.name).join(", ") || "—", r.triggers.map((t) => T.triggers[t]).join(", ") || "—", (r.note || "").split("\n")[0]]
          .forEach((v, i) => { const td = document.createElement("td"); td.textContent = v; if (i === 5) td.className = "t"; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      $("#imp-go").disabled = !fresh;
      $("#imp-go").textContent = fresh ? `Імпортувати ${fresh}` : "Немає нових записів";
      $("#imp-sheet").showModal();
    } catch (e) { fail(e); }
  });
  $("#imp-go").addEventListener("click", async () => {
    const btn = $("#imp-go"); busy(btn, true);
    try {
      const n = await Store.addMany(pending.filter((r) => !r.dup).map(({ dup, ...r }) => r));
      $("#imp-sheet").close(); await reload(); toast(`Імпортовано ${n} записів`); loadEnv();
    } catch (e) { fail(e); } finally { busy(btn, false); }
  });

  /* ---------- експорт ---------- */
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const stamp = () => today();
  $("#exp-csv").addEventListener("click", () => {
    if (!S.episodes.length) return toast("Ще немає записів");
    const rows = [["date", "start", "end", "duration_min", "onset", "intensity", "sides", "meds", "relief", "triggers", "nausea", "note", "source"]];
    S.episodes.slice().reverse().forEach((e) => {
      const s = new Date(e.started_at);
      rows.push([dayKey(s), hm(e.started_at), e.ended_at ? `${dayKey(new Date(e.ended_at))} ${hm(e.ended_at)}` : "", e.ended_at ? Math.round((new Date(e.ended_at) - s) / 6e4) : "",
        T.onset[e.onset] || "", e.intensity ?? "", (e.sides || []).map((x) => T.sides[x] || x).join("; "),
        (e.meds || []).map((m) => `${m.name}${m.at ? " " + hm(m.at) : ""}`).join("; "), T.relief[e.relief] || "",
        (e.triggers || []).map((x) => T.triggers[x] || x).join("; "), e.nausea ? "так" : "", e.note || "", e.source || ""]);
    });
    download(`nimb-${stamp()}.csv`, Tags.toCSV(rows), "text/csv;charset=utf-8");
  });
  $("#exp-json").addEventListener("click", () => {
    if (!S.episodes.length) return toast("Ще немає записів");
    download(`nimb-${stamp()}.json`, JSON.stringify({ app: "NIMB", version: NIMB_VERSION, exported_at: new Date().toISOString(), episodes: S.episodes.slice().reverse(), ok_days: S.okDays.slice().sort() }, null, 2), "application/json");
  });

  /* ---------- старт ---------- */
  applyTheme(S.prefs.theme);
  window.addEventListener("resize", () => { if ($("#screen-stats").classList.contains("active")) renderStats(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Store.mode !== "none") renderHome(); });
  Store.init().then((mode) => (mode === "none" ? go("auth") : enter()));
})();
