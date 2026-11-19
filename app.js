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
  const WD = ["Понеділок", "Вівторок", "Середа", "Четвер", "П’ятниця", "Субота", "Неділя"];
  const WD_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  const durText = (ms) => { const m = Math.max(0, Math.round(ms / 6e4)); const h = Math.floor(m / 60); return h ? `${h} год ${m % 60} хв` : `${m} хв`; };
  const dmy = (d) => `${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
  // Тост кладемо у відкритий лист, інакше лист (верхній шар) його перекриває.
  function toast(text) {
    const t = document.createElement("div"); t.className = "toast"; t.textContent = text; t.setAttribute("role", "status");
    const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
    host.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  // Українська множина: pl(5, "запис", "записи", "записів") → "5 записів".
  const PR = new Intl.PluralRules("uk");
  const pl = (n, one, few, many) => `${n} ${{ one, few, many, other: few }[PR.select(n)] || many}`;
  // Помилка всередині листа — під полями, поруч із кнопкою.
  function sheetErr(id, text) { const m = $(id); m.textContent = text || ""; m.hidden = !text; }
  // Своє підтвердження замість confirm(): повертає true / false.
  function ask(title, text, yes, no) {
    return new Promise((res) => {
      const d = $("#ask-sheet"); let done = false;
      // d.dataset.choice: "yes" | "no" | "close" — щоб відрізнити «Ні» від закриття листа.
      const end = (v, how) => { if (done) return; done = true; d.dataset.choice = how; if (d.open) d.close(); res(v); };
      $("#ask-title").textContent = title; $("#ask-text").textContent = text;
      $("#ask-yes").textContent = yes; $("#ask-no").textContent = no;
      $("#ask-yes").onclick = () => end(true, "yes"); $("#ask-no").onclick = () => end(false, "no");
      d.addEventListener("close", () => end(false, "close"), { once: true });
      d.showModal();
    });
  }
  function busy(btn, on) { btn.classList.toggle("loading", on); btn.disabled = on; }
  // Сила болю 0–10: 11 кнопок замість повзунка. Повторний тап знімає вибір.
  function intChips(box, value, onPick) {
    box.innerHTML = "";
    for (let n = 0; n <= 10; n++) {
      const b = document.createElement("button"); b.type = "button"; b.className = "int-chip"; b.textContent = n;
      b.setAttribute("aria-pressed", value === n); b.setAttribute("aria-label", `Сила ${n} з 10`);
      b.onclick = () => { value = value === n ? null : n; [...box.children].forEach((c, i) => c.setAttribute("aria-pressed", value === i)); onPick(value); };
      box.appendChild(b);
    }
  }
  // «Коли?» — швидкі варіанти «N хв тому» або свій час. Повертає ISO або null (закрили).
  const AGO = [[0, "Зараз"], [15, "15 хв тому"], [30, "30 хв тому"], [60, "1 год тому"], [120, "2 год тому"], [180, "3 год тому"]];
  function agoChips(box, min, onPick) {
    box.innerHTML = "";
    const now = Date.now();
    AGO.filter(([m]) => !min || now - m * 6e4 >= min).forEach(([m, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = label;
      b.onclick = () => { [...box.children].forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", c === b); }); onPick(new Date(now - m * 6e4).toISOString()); };
      box.appendChild(b);
    });
  }
  function pickWhen({ title, value, min, minErr }) {
    return new Promise((res) => {
      const d = $("#when-sheet"); let done = false;
      const end = (v) => { if (done) return; done = true; if (d.open) d.close(); res(v); };
      $("#when-title").textContent = title;
      const inp = $("#when-at"); inp.value = toLocalInput(value || new Date().toISOString()); inp.max = toLocalInput(new Date().toISOString());
      sheetErr("#when-err", "");
      agoChips($("#when-quick"), min, end);
      $("#when-save").onclick = () => {
        const at = fromLocalInput(inp.value);
        if (!at) return sheetErr("#when-err", "Вибери дату й час.");
        if (+new Date(at) > Date.now() + 6e4) return sheetErr("#when-err", "Цей час ще не настав. Перевір дату й час.");
        if (min && +new Date(at) < min) return sheetErr("#when-err", minErr || "Занадто давно.");
        end(at);
      };
      d.addEventListener("close", () => end(null), { once: true });
      d.showModal();
    });
  }
  // Назва останньої таблетки — для швидкої кнопки.
  const lastMedName = () => { for (const e of S.episodes) if (e.meds && e.meds.length) return e.meds[e.meds.length - 1].name; return "Цитрамон"; };
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
    const app = name !== "auth" && name !== "reset";
    $("#tabs").hidden = !app; document.body.classList.toggle("no-tabs", !app);
    if (name === "stats") renderStats();
    window.scrollTo(0, 0);
  }
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

  /* ---------- вхід ---------- */
  let authTab = "in";
  $$("[data-authtab]").forEach((b) => b.addEventListener("click", () => {
    authTab = b.dataset.authtab;
    $$("[data-authtab]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    $("#auth-go").textContent = authTab === "in" ? "Увійти" : "Створити акаунт";
    $("#auth-forgot").hidden = authTab !== "in";
    $("#auth-pass").autocomplete = authTab === "in" ? "current-password" : "new-password";
    $("#auth-msg").hidden = true;
  }));
  function authMsg(text, ok) { const m = $("#auth-msg"); m.textContent = text; m.className = "note " + (ok ? "ok" : "error"); m.hidden = false; }
  // Помилки Supabase → зрозумілі тексти українською.
  function authText(e) {
    const m = String((e && e.message) || e);
    if (/[а-яіїєґ]/i.test(m)) return m; // уже наш текст
    if (/invalid login/i.test(m)) return "Невірна пошта або пароль.";
    if (/not confirmed/i.test(m)) return "Спершу підтвердь пошту за посиланням з листа.";
    if (/already registered|already exists/i.test(m)) return "Акаунт з цією поштою вже є. Перейди на «Вхід».";
    if (/rate limit|too many|seconds/i.test(m)) return "Забагато спроб. Зачекай хвилину й спробуй ще раз.";
    if (/password.*(at least|short|weak)|weak password/i.test(m)) return "Пароль заслабкий. Візьми довший, з цифрами й літерами.";
    if (/same password|different from the old/i.test(m)) return "Новий пароль має відрізнятися від старого.";
    if (/invalid.*email|email.*invalid/i.test(m)) return "Перевір адресу пошти.";
    if (/fetch|network|failed to/i.test(m) || !navigator.onLine) return "Немає зʼєднання з сервером. Перевір інтернет.";
    return "Не вдалося. Спробуй ще раз. (" + m + ")";
  }
  $("#auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#auth-msg").hidden = true;
    const email = $("#auth-email").value.trim(), pass = $("#auth-pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg("Перевір адресу пошти.");
    if (pass.length < 6) return authMsg("Пароль — щонайменше 6 символів.");
    const btn = $("#auth-go"); busy(btn, true);
    try {
      if (authTab === "in") await Store.signIn(email, pass);
      else {
        const r = await Store.signUp(email, pass);
        if (r.needsConfirm) { busy(btn, false); return authMsg("Лист з підтвердженням уже на пошті. Відкрий посилання й увійди. Якщо акаунт з цією поштою вже є — просто увійди.", true); }
      }
      await offerMigrate();
      await enter();
    } catch (e) {
      authMsg(authText(e));
    } finally { busy(btn, false); }
  });
  // Записи гостя переносимо в акаунт лише за згодою.
  async function offerMigrate() {
    const n = Store.guestCount();
    if (!n) return;
    const yes = await ask("Перенести записи?", `У цьому браузері є ${pl(n, "запис", "записи", "записів")} без акаунта. Перенести в акаунт ${Store.user.email}?`, "Перенести", "Ні, залишити в браузері");
    if (!yes) return;
    try { const moved = await Store.migrateGuest(); if (moved) toast(`Перенесено: ${pl(moved, "запис", "записи", "записів")}`); }
    catch (e) { toast("Не вдалося перенести записи. Вони лишились у браузері."); }
  }
  $("#auth-forgot").addEventListener("click", async () => {
    const email = $("#auth-email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $("#auth-email").focus(); return authMsg("Впиши пошту, на яку зареєстровано акаунт, і натисни ще раз."); }
    const btn = $("#auth-forgot"); btn.disabled = true;
    try { await Store.resetPassword(email); authMsg("Якщо акаунт з цією поштою є, лист із посиланням для нового пароля вже в дорозі.", true); }
    catch (e) { authMsg(authText(e)); }
    finally { btn.disabled = false; }
  });
  $("#reset-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pass = $("#reset-pass").value, msg = $("#reset-msg");
    msg.hidden = true;
    if (pass.length < 6) { msg.textContent = "Пароль — щонайменше 6 символів."; msg.hidden = false; return; }
    const btn = $("#reset-go"); busy(btn, true);
    try {
      await Store.updatePassword(pass); history.replaceState(null, "", location.pathname); $("#reset-pass").value = "";
      if (changingPass) { changingPass = false; go("settings"); toast("Пароль змінено"); } else { toast("Пароль змінено"); await enter(); }
    }
    catch (e) { msg.textContent = authText(e); msg.hidden = false; }
    finally { busy(btn, false); }
  });
  $("#auth-guest").addEventListener("click", () => { Store.useGuest(); enter(); });
  // «Змінити пароль» у налаштуваннях — той самий екран, що й після листа.
  let changingPass = false;
  $("#reset-cancel").addEventListener("click", () => { changingPass = false; go("settings"); });

  /* ---------- завантаження ---------- */
  async function enter() {
    go("home");
    S.prefs = await Store.pullPrefs().catch(() => Store.prefs());
    applyTheme(S.prefs.theme);
    renderSettings();
    renderRisk();
    await reload();
    loadEnv();
  }
  async function reload() {
    try { [S.episodes, S.okDays] = await Promise.all([Store.list(), Store.okDays()]); }
    catch (e) { fail(e); }
    renderHome(); renderHistory(); renderNet();
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
  // «Болить зараз» — запис без «Минуло», що почався не раніше ніж за 12 год до створення
  // (початок можна перенести назад: «почалося 2 год тому») і не старший за 48 год.
  // Давніший запис без кінця і імпорт не стають активними.
  const LIVE_BACK = 12 * 3600e3;
  const liveMin = (x) => (x.created_at ? +new Date(x.created_at) : Date.now()) - LIVE_BACK;
  const LIVE_MIN_ERR = "Понад 12 год тому — це вже минулий епізод. Додай його через «Минулий епізод».";
  const isLive = (x) => {
    const c = x.created_at ? +new Date(x.created_at) : NaN, st = +new Date(x.started_at);
    return !x.ended_at && x.source !== "import" && Number.isFinite(c) && c - st > -15 * 6e4 && c - st <= LIVE_BACK && Date.now() - st < 48 * 3600e3;
  };
  function activeEpisode() { return S.episodes.find(isLive) || null; }
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
        <div class="card-head"><span class="eyebrow">Болить зараз</span><button class="link small-link" id="a-start" aria-label="Змінити час початку">з ${hm(a.started_at)} · змінити</button></div>
        <h2 class="sr-only">Болить зараз</h2>
        <p class="timer" id="t-elapsed"></p>
        <p class="small muted" id="t-meds"></p>
        <div class="row"><button class="btn ghost small" id="a-med"></button><button class="btn ghost small" id="a-more">Деталі</button></div>
        <div class="field" id="a-relief" hidden><span>Таблетка допомогла?</span><div class="chips"></div></div>
        <button class="btn primary" id="a-end">Минуло</button>
        <button class="link center" id="a-undo" hidden>Натиснув випадково — прибрати запис</button>`;
      slot.appendChild(c);
      const tick = () => { const el = $("#t-elapsed"); if (el) el.textContent = durText(Date.now() - new Date(a.started_at)); };
      tick(); timerId = setInterval(tick, 10000);
      $("#t-meds").textContent = meds.length ? "Таблетки: " + meds.map((m) => `${m.name} о ${hm(m.at || a.started_at)}`).join(", ") : "Таблетку не пив";
      if (meds.length && !a.relief && Date.now() - lastMed > 40 * 6e4) {
        const box = $("#a-relief"); box.hidden = false;
        Object.entries(T.relief).forEach(([k, v]) => {
          const b = document.createElement("button"); b.className = "chip"; b.textContent = v;
          b.onclick = async () => { await saveEp(a.id, { ...a, relief: k }); toast("Записав"); };
          box.querySelector(".chips").appendChild(b);
        });
      }
      const med = lastMedName();
      $("#a-med").textContent = "+ " + med;
      $("#a-med").onclick = async () => {
        const at = await pickWhen({ title: `Коли випив ${med}?` });
        if (!at) return;
        await saveEp(a.id, { ...a, meds: [...meds, { name: med, at }] }); toast(`${med} о ${hm(at)} записано`);
      };
      $("#a-start").onclick = async () => {
        const at = await pickWhen({ title: "Коли почало боліти?", value: a.started_at, min: liveMin(a), minErr: LIVE_MIN_ERR });
        if (!at) return;
        const d = dayKey(new Date(at));
        try { if (S.okDays.includes(d)) await Store.unmarkOk(d); } catch (e) { fail(e); }
        await saveEp(a.id, { ...a, started_at: at, onset: Tags.onsetOf(new Date(at)) }); toast(`Почалося о ${hm(at)}`);
      };
      $("#a-more").onclick = () => openSheet(a, { live: true });
      $("#a-end").onclick = async () => { const ended = { ...a, ended_at: new Date().toISOString() }; await saveEp(a.id, ended); openEnd(ended); };
      // Перші 10 хвилин можна прибрати випадковий запис без питань.
      if (Date.now() - new Date(a.created_at || a.started_at) < 10 * 6e4) { $("#a-undo").hidden = false; $("#a-undo").onclick = () => undoPain(a.id); }
    }
    const t = today();
    const hadToday = S.episodes.some((e) => dayKey(new Date(e.started_at)) === t);
    const okb = $("#btn-ok");
    okb.disabled = hadToday;
    okb.textContent = hadToday ? "Сьогодні вже є запис болю" : S.okDays.includes(t) ? "✓ Сьогодні без болю" : "Сьогодні без болю";

    renderList($("#recent-list"), S.episodes.slice(0, 3), true);
  }
  $("#btn-pain").addEventListener("click", async () => {
    const now = new Date();
    try {
      const e = await Store.add({ started_at: now.toISOString(), onset: Tags.onsetOf(now) });
      if (S.okDays.includes(today())) await Store.unmarkOk(today());
      await reload();
      openSheet(e, { title: "Болить зараз", live: true, undo: true });
    } catch (err) { fail(err); }
  });
  async function undoPain(id) {
    try { await Store.remove(id); if (sheet.open) sheet.close(); await reload(); toast("Запис прибрано"); } catch (e) { fail(e); }
  }
  /* ---------- після «Минуло»: сила і чи допомогла таблетка ---------- */
  let endEp = null, endInt = null, endRel = null;
  function openEnd(e) {
    endEp = e; endInt = e.intensity ?? null; endRel = e.relief || null;
    $("#end-sub").textContent = `Тривало ${durText(new Date(e.ended_at) - new Date(e.started_at))}. Добре, що минуло.`;
    intChips($("#end-int"), endInt, (v) => { endInt = v; });
    const hasMeds = !!(e.meds && e.meds.length);
    $("#end-relief-f").hidden = !hasMeds;
    const box = $("#end-relief"); box.innerHTML = "";
    Object.entries(T.relief).forEach(([k, v]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = v;
      b.setAttribute("aria-pressed", endRel === k); b.classList.toggle("on", endRel === k);
      b.onclick = () => { endRel = endRel === k ? null : k; [...box.children].forEach((c, i) => { const on = Object.keys(T.relief)[i] === endRel; c.classList.toggle("on", on); c.setAttribute("aria-pressed", on); }); };
      box.appendChild(b);
    });
    $("#end-sheet").showModal();
  }
  $("#end-save").addEventListener("click", async () => {
    $("#end-sheet").close();
    if (endEp) { await saveEp(endEp.id, { ...endEp, intensity: endInt, relief: endEp.meds && endEp.meds.length ? endRel : null }); toast("Збережено"); }
  });
  $("#end-skip").addEventListener("click", () => $("#end-sheet").close());
  $("#btn-ok").addEventListener("click", async () => {
    const t = today();
    try { if (S.okDays.includes(t)) await Store.unmarkOk(t); else { await Store.markOk(t); toast("Відмічено. Такі дні роблять прогноз точнішим"); } await reload(); }
    catch (e) { fail(e); }
  });
  $("#btn-past").addEventListener("click", () => openSheet(null, { title: "Минулий епізод" }));
  // Інший день без болю (минулі дні теж).
  $("#btn-ok-other").addEventListener("click", () => {
    const inp = $("#ok-day"); inp.max = today(); inp.value = shift(today(), -1);
    sheetErr("#ok-err", ""); $("#ok-sheet").showModal();
  });
  $("#ok-save").addEventListener("click", async () => {
    const d = $("#ok-day").value;
    if (!d) return sheetErr("#ok-err", "Вибери дату.");
    if (d > today()) return sheetErr("#ok-err", "Майбутній день відмітити не можна.");
    if (S.episodes.some((e) => dayKey(new Date(e.started_at)) === d)) return sheetErr("#ok-err", "На цей день уже є запис болю. Спершу видали його в Історії.");
    if (S.okDays.includes(d)) return sheetErr("#ok-err", "Цей день уже відмічено.");
    const btn = $("#ok-save"); busy(btn, true);
    try { await Store.markOk(d); $("#ok-sheet").close(); await reload(); toast("Відмічено день без болю"); }
    catch (e) { sheetErr("#ok-err", e.message || "Не вдалося зберегти."); }
    finally { busy(btn, false); }
  });

  // Який день показує прогноз: 0 — сьогодні, 1 — завтра, 2 — післязавтра. Увечері за замовчуванням — завтра.
  S.riskDay = new Date().getHours() < 18 ? 0 : 1;
  const dayName = (i, k) => { const dt = new Date(k + "T12:00:00"); return i === 0 ? "Сьогодні" : i === 1 ? "Завтра" : WD_SHORT[(dt.getDay() + 6) % 7] + ", " + dt.getDate(); };
  function renderRisk() {
    const card = $("#risk-card");
    const m = S.model, t = today(), sel = shift(t, S.riskDay);
    $("#risk-place").textContent = S.place ? (S.place.name || "За геолокацією") + (S.place.how === "default" ? " · змінити" : "") : "";
    $("#risk-when").textContent = S.riskDay === 0 ? "Ризик сьогодні" : S.riskDay === 1 ? "Ризик на завтра" : "Ризик: " + WD[(new Date(sel + "T12:00:00").getDay() + 6) % 7].toLowerCase();
    const r = m ? Env.riskFor(S.env[sel], m) : null;
    const why = $("#risk-why"), chips = $("#risk-factors"), days = $("#risk-days"), line = $("#env-line"), note = $("#risk-note");
    chips.innerHTML = ""; days.innerHTML = ""; line.innerHTML = "";
    if (!r) {
      card.dataset.level = ""; $("#risk-level").textContent = "—";
      why.textContent = S.envErrors.length ? "Не вдалося завантажити погоду. Перевір інтернет." : "Завантажую погоду…";
      note.textContent = ""; return;
    }
    card.dataset.level = r.level;
    $("#risk-level").textContent = Env.LEVEL[r.level];
    const names = r.factors.map((f) => f.label.toLowerCase()).join(", ");
    why.textContent = r.level !== "low"
      ? `${r.factors.map((f) => f.label).join(", ")}. У такі дні болить у ${fmtN(r.mult, 1)} раза частіше, ніж зазвичай.`
      : r.factors.length ? `Є слабкі чинники (${names}), але ризик майже такий, як у звичайний день.` : "Нічого незвичного в погоді.";
    if (r.level !== "low") r.factors.forEach((f) => { const c = document.createElement("span"); c.className = "chip static"; c.textContent = f.label; chips.appendChild(c); });
    [0, 1, 2].forEach((i) => {
      const k = shift(t, i), rr = Env.riskFor(S.env[k], m);
      const d = document.createElement("button"); d.type = "button"; d.className = "day3"; if (rr) d.dataset.level = rr.level;
      d.setAttribute("aria-pressed", i === S.riskDay);
      d.innerHTML = `<b></b><span class="lv"></span>`;
      d.querySelector("b").textContent = dayName(i, k);
      d.querySelector(".lv").textContent = rr ? Env.LEVEL[rr.level] : "—";
      d.onclick = () => { S.riskDay = i; renderRisk(); };
      days.appendChild(d);
    });
    const e = S.env[sel] || {};
    const bits = [];
    if (e.pressure_mean != null) bits.push(["Тиск", `${fmtN(e.pressure_mean)} гПа` + (e.pressure_delta != null ? `, ${e.pressure_delta > 0 ? "+" : ""}${fmtN(e.pressure_delta, 1)} за добу` : "")]);
    if (e.temp_max != null) bits.push(["До", `${fmtN(e.temp_max)} °C`]);
    if (e.kp_max != null) bits.push(["Магнітне поле", (e.kp_max >= 5 ? "буря" : e.kp_max >= 4 ? "збурене" : "спокійне") + ` (Kp ${fmtN(e.kp_max, 1)})`]);
    if (e.pm25_mean != null) bits.push(["Повітря", (e.pm25_mean >= 25 ? "брудне" : e.pm25_mean >= 15 ? "помірне" : "чисте") + ` (PM2.5 ${fmtN(e.pm25_mean)} мкг/м³)`]);
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
    box.innerHTML = ""; box.classList.toggle("is-empty", !items.length);
    if (!items.length) { box.innerHTML = `<p class="empty">${Store.stale && !S.episodes.length ? "Не вдалося завантажити записи. Перевір інтернет." : compact ? "Поки немає записів. Коли заболить — тисни «Болить»." : "Нічого не знайшов"}</p>`; return; }
    items.forEach((e) => {
      const d = new Date(e.started_at);
      const b = document.createElement("button"); b.className = "item";
      b.innerHTML = `<span class="date"><b></b><span></span></span><span class="what"><b></b><p></p></span><span class="int"></span>`;
      b.querySelector(".date b").textContent = d.getDate();
      b.querySelector(".date span").textContent = MON_SHORT[d.getMonth()];
      b.querySelector(".what b").textContent = epTitle(e);
      b.querySelector(".what p").textContent = epSub(e);
      const i = b.querySelector(".int");
      if (e.intensity != null) { i.textContent = e.intensity; i.dataset.i = ""; i.style.setProperty("--i", e.intensity); i.classList.toggle("hi", e.intensity >= 7); i.setAttribute("aria-label", "Сила " + e.intensity); }
      else { i.textContent = "–"; i.setAttribute("aria-label", "Сила не вказана"); }
      b.onclick = () => openSheet(e, { live: isLive(e) });
      box.appendChild(b);
    });
  }

  /* ---------- історія ---------- */
  // Рядок «день без болю» в історії. Тап — прибрати відмітку.
  function okRow(day) {
    const d = new Date(day + "T12:00:00");
    const b = document.createElement("button"); b.className = "item ok-item";
    b.innerHTML = `<span class="date"><b></b><span></span></span><span class="what"><b>Без болю</b><p></p></span><span class="int ok" aria-hidden="true">✓</span>`;
    b.querySelector(".date b").textContent = d.getDate();
    b.querySelector(".date span").textContent = MON_SHORT[d.getMonth()];
    b.onclick = async () => {
      if (!(await ask("Прибрати відмітку?", `${d.getDate()} ${MON_SHORT[d.getMonth()]} — день без болю. Прибрати цю відмітку?`, "Прибрати", "Залишити"))) return;
      try { await Store.unmarkOk(day); await reload(); toast("Відмітку прибрано"); } catch (e) { fail(e); }
    };
    return b;
  }
  let histF = "";
  $$("#hist-f .chip").forEach((b) => b.addEventListener("click", () => {
    histF = b.dataset.f;
    $$("#hist-f .chip").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b); });
    renderHistory();
  }));
  function renderHistory() {
    const q = $("#hist-q").value.trim().toLowerCase();
    const fOk = (e) => histF === "" || (histF === "strong" && e.intensity >= 7) || (histF === "meds" && e.meds && e.meds.length);
    const eps = histF === "ok" ? [] : S.episodes.filter((e) => fOk(e) && (!q || [e.note, epTitle(e), ...(e.triggers || []).map((x) => T.triggers[x])].join(" ").toLowerCase().includes(q)));
    const oks = (histF === "" || histF === "ok") && (!q || "без болю".includes(q)) ? S.okDays.slice() : [];
    // Один список: епізоди й дні без болю, від нових до старих.
    const items = [...eps.map((e) => ({ at: e.started_at, e })), ...oks.map((day) => ({ at: new Date(day + "T12:00:00").toISOString(), ok: day }))]
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const bits = [];
    if (S.episodes.length) bits.push(pl(S.episodes.length, "запис", "записи", "записів"));
    if (S.okDays.length) bits.push(pl(S.okDays.length, "день", "дні", "днів") + " без болю");
    $("#hist-count").textContent = bits.join(" · ");
    const box = $("#hist-list"); box.innerHTML = "";
    if (!items.length) { box.innerHTML = `<p class="empty">${Store.stale && !S.episodes.length ? "Не вдалося завантажити записи. Перевір інтернет." : S.episodes.length || S.okDays.length ? "Нічого не знайшов" : "Поки немає записів. Можна імпортувати щоденник у Налаштуваннях."}</p>`; return; }
    let cur = null, list = null;
    items.forEach((it) => {
      const d = new Date(it.at), k = d.getFullYear() + "-" + d.getMonth();
      if (k !== cur) {
        cur = k;
        const n = items.filter((x) => x.e && (() => { const y = new Date(x.at); return y.getFullYear() + "-" + y.getMonth() === k; })()).length;
        const h = document.createElement("p"); h.className = "month-h"; h.textContent = `${MON_FULL[d.getMonth()]} ${d.getFullYear()} · ${n}`;
        list = document.createElement("div"); list.className = "list";
        box.append(h, list);
      }
      if (it.ok) { list.appendChild(okRow(it.ok)); return; }
      const tmp = document.createElement("div"); renderList(tmp, [it.e]); list.appendChild(tmp.firstChild);
    });
  }
  $("#hist-q").addEventListener("input", renderHistory);

  /* ---------- лист запису ---------- */
  const sheet = $("#ep-sheet");
  let editing = null, form = null, sheetLive = false;
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
          // Під час болю — час тапу; для минулого запису — час початку.
          // Під час болю — час тапу; для минулого запису — час початку. Час потім можна змінити нижче.
          else form.meds.push({ name: k, at: sheetLive ? new Date().toISOString() : fromLocalInput($("#ep-start").value) || new Date().toISOString() });
          $("#ep-relief-f").hidden = !form.meds.length;
          renderMedTimes();
        } else if (opts.single) form[name] = form[name] === k ? null : k;
        else form[name] = form[name].includes(k) ? form[name].filter((x) => x !== k) : [...form[name], k];
        $$(".chip", box).forEach((c) => c._paint());
      };
      b._paint = paint; paint(); box.appendChild(b);
    });
  }
  // Час кожної таблетки — окреме поле, щоб записати «випив 2 години тому».
  function renderMedTimes() {
    const box = $("#ep-med-times"); box.innerHTML = "";
    const count = {};
    form.meds.forEach((m) => {
      count[m.name] = (count[m.name] || 0) + 1;
      const l = document.createElement("label"); l.className = "med-time";
      const s = document.createElement("span"); s.textContent = `${T.meds[m.name] || m.name}${count[m.name] > 1 ? ` · ${count[m.name]}-га` : ""} — коли випив`;
      const inp = document.createElement("input"); inp.type = "datetime-local";
      inp.value = toLocalInput(m.at || form.started_at); inp.max = toLocalInput(new Date().toISOString());
      inp.onchange = () => { const v = fromLocalInput(inp.value); if (v) m.at = v; };
      l.append(s, inp); box.appendChild(l);
    });
  }
  // Для минулого запису таблетки «в момент початку» їдуть разом із початком.
  $("#ep-start").addEventListener("change", () => {
    const v = fromLocalInput($("#ep-start").value);
    if (!form || !v) return;
    form.meds.forEach((m) => { if (!m.at || m.at === form._start) m.at = v; });
    form._start = v; renderMedTimes();
  });
  function openSheet(e, opt = {}) {
    editing = e && e.id ? e : null;
    const now = new Date();
    form = {
      started_at: e ? e.started_at : now.toISOString(), ended_at: e ? e.ended_at : null,
      intensity: e ? e.intensity : null, sides: [...((e && e.sides) || [])], meds: ((e && e.meds) || []).map((m) => ({ ...m })),
      relief: e ? e.relief : null, triggers: [...((e && e.triggers) || [])], nausea: !!(e && e.nausea), note: (e && e.note) || "",
      onset: e ? e.onset : null, source: e ? e.source : "app",
    };
    sheetLive = !!opt.live;
    const st = new Date(form.started_at);
    $("#ep-title").textContent = opt.title || (editing ? `Запис · ${dmy(st)}, ${hm(form.started_at)}` : "Запис");
    $("#ep-start").value = toLocalInput(form.started_at);
    $("#ep-end").value = toLocalInput(form.ended_at);
    intChips($("#ep-int"), form.intensity, (v) => { form.intensity = v; });
    $("#ep-undo").hidden = !opt.undo;
    $("#ep-nausea").checked = form.nausea;
    $("#ep-note").value = form.note;
    chipGroup("sides", T.sides); chipGroup("meds", T.meds); chipGroup("relief", T.relief, { single: true }); chipGroup("triggers", T.triggers);
    $("#ep-relief-f").hidden = !form.meds.length;
    form._start = form.started_at; renderMedTimes();
    // Під час болю — швидкі «почалося N хв тому».
    const q = $("#ep-start-quick"); q.hidden = !sheetLive;
    if (sheetLive) agoChips(q, editing ? liveMin(editing) : 0, (at) => { $("#ep-start").value = toLocalInput(at); $("#ep-start").dispatchEvent(new Event("change")); });
    $("#ep-del").hidden = !editing;
    sheetErr("#ep-err", "");
    sheet.showModal();
  }
  $("#ep-undo").addEventListener("click", () => { if (editing) undoPain(editing.id); });
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog.sheet").forEach((d) => d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }));
  async function saveEp(id, data) {
    try { await Store.update(id, data); await reload(); } catch (e) { fail(e); }
  }
  $("#ep-save").addEventListener("click", async () => {
    const start = fromLocalInput($("#ep-start").value) || new Date().toISOString();
    let end = fromLocalInput($("#ep-end").value);
    sheetErr("#ep-err", "");
    if (end && end < start) return sheetErr("#ep-err", "«Минуло» раніше, ніж «Почалося». Перевір час.");
    if (start > new Date(Date.now() + 5 * 6e4).toISOString()) return sheetErr("#ep-err", "Початок у майбутньому. Перевір дату й час.");
    if (sheetLive && editing && !end && +new Date(start) < liveMin(editing)) return sheetErr("#ep-err", LIVE_MIN_ERR);
    if (form.meds.some((m) => m.at && +new Date(m.at) > Date.now() + 5 * 6e4)) return sheetErr("#ep-err", "Час таблетки в майбутньому. Перевір дату й час.");
    const { _start, ...rest } = form;
    const data = {
      ...rest, started_at: start, ended_at: end,
      onset: editing && editing.started_at === start && form.onset ? form.onset : Tags.onsetOf(new Date(start)),
      intensity: form.intensity,
      nausea: $("#ep-nausea").checked, note: $("#ep-note").value.trim(),
    };
    if (!data.meds.length) data.relief = null;
    const btn = $("#ep-save"); busy(btn, true);
    try {
      if (editing) await Store.update(editing.id, data); else await Store.add(data);
      const d = dayKey(new Date(start)); if (S.okDays.includes(d)) await Store.unmarkOk(d);
      sheet.close(); await reload(); toast("Збережено");
    } catch (e) { console.error(e); sheetErr("#ep-err", "Не вдалося зберегти. " + (e.message || "")); } finally { busy(btn, false); }
  });
  $("#ep-del").addEventListener("click", async () => {
    if (!editing || !(await ask("Видалити запис?", "Запис зникне з історії й статистики.", "Видалити", "Залишити"))) return;
    try { await Store.remove(editing.id); sheet.close(); await reload(); toast("Видалено"); } catch (e) { sheetErr("#ep-err", "Не вдалося видалити. " + (e.message || "")); }
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
    const days = [...new Set(eps.map((e) => dayKey(new Date(e.started_at))))].sort();
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
      kpi("Таблетка допомогла", rel.length ? fmtN((relYes / rel.length) * 100) + "%" : "—", rel.length ? `з ${pl(rel.length, "відмітки", "відміток", "відміток")}` : "відмічай у записі"),
      kpi("Сила, середня", ints.length ? fmtN(ints.reduce((s, e) => s + e.intensity, 0) / ints.length, 1) : "—", ints.length ? `з 10 · ${pl(ints.length, "запис", "записи", "записів")}` : ""),
    );
    $("#few-note").hidden = !(all.length && all.length < 5);
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
    // «Усе» — від першого запису, але не більше 3 років.
    const firstAll = all.length ? new Date(all[all.length - 1].started_at) : new Date();
    const weeks = S.range === 90 ? 13 : S.range ? 53 : Math.min(156, Math.max(53, Math.ceil((now - firstAll) / (7 * 864e5)) + 1));
    Charts.heat($("#heat"), lv, weeks, dayKey, $("#heat-months"));

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
      const x = f.rr >= 1.15 ? "up" : f.rr <= 0.87 ? "down" : "flat";
      d.innerHTML = `<b></b><span class="x ${x}"></span><span class="d"></span>`;
      d.children[0].textContent = f.label;
      d.children[1].textContent = "×" + fmtN(f.rr, 1) + (x === "down" ? " · рідше" : "");
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
    $("#acc-pass").hidden = Store.mode !== "supabase";
    $("#delacc-btn").hidden = Store.mode !== "supabase";
    $("#ver").textContent = `Версія ${NIMB_VERSION}.`;
  }
  function renderLocNow() {
    const p = S.place; if (!p) return;
    $("#loc-now").textContent = S.prefs.location_mode === "manual" && !S.prefs.place ? `Обери місто зі списку. Поки беру: ${p.name || "геолокацію"}.` : p.how === "manual" ? `Зараз: ${p.name}` : p.how === "auto" ? `Зараз: за геолокацією (${fmtN(p.lat, 2)}, ${fmtN(p.lon, 2)})` : `Геолокація недоступна — беру ${p.name}. Дозволь доступ до місця або задай місто вручну.`;
  }
  $$("#theme-seg .seg").forEach((b) => b.addEventListener("click", async () => { S.prefs = await Store.setPrefs({ theme: b.dataset.themeV }); applyTheme(S.prefs.theme); }));
  $$("#loc-seg .seg").forEach((b) => b.addEventListener("click", async () => {
    S.prefs = await Store.setPrefs({ location_mode: b.dataset.loc });
    renderSettings();
    if (b.dataset.loc === "auto" || S.prefs.place) loadEnv(); else { renderLocNow(); $("#city-q").focus(); }
  }));
  let cityT = null;
  $("#city-q").addEventListener("input", (ev) => {
    clearTimeout(cityT);
    const q = ev.target.value.trim(); const box = $("#city-results");
    if (q.length < 2) { box.innerHTML = ""; return; }
    box.innerHTML = '<p class="small muted">Шукаю…</p>';
    cityT = setTimeout(async () => {
      try {
        const res = await Env.searchCity(q); box.innerHTML = "";
        if (!res.length) box.innerHTML = '<p class="small muted">Не знайшов</p>';
        res.forEach((c) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = `${c.name}${c.region ? ", " + c.region : ""}`;
          b.onclick = async () => { S.prefs = await Store.setPrefs({ location_mode: "manual", place: { name: c.name, lat: c.lat, lon: c.lon } }); box.innerHTML = ""; ev.target.value = ""; renderSettings(); toast(`Місце: ${c.name}`); loadEnv(); };
          box.appendChild(b);
        });
      } catch (e) { box.innerHTML = '<p class="small muted">Пошук недоступний</p>'; }
    }, 350);
  });
  $("#acc-btn").addEventListener("click", async () => {
    if (Store.mode === "supabase") {
      const p = Store.pending;
      const text = p ? `${pl(p, "зміна ще не відправлена", "зміни ще не відправлені", "змін ще не відправлено")} — після виходу вони зникнуть.` : "Записи залишаться в акаунті. З цього браузера їх буде прибрано.";
      if (!(await ask("Вийти з акаунта?", text, "Вийти", "Залишитися"))) return;
    }
    await Store.signOut();
    S.episodes = []; S.okDays = [];
    go("auth");
  });

  $("#acc-pass").addEventListener("click", () => { changingPass = true; $("#reset-cancel").hidden = false; $("#reset-msg").hidden = true; go("reset"); $("#reset-pass").focus(); });
  $("#wipe-btn").addEventListener("click", async () => {
    const n = S.episodes.length + S.okDays.length;
    if (!n) return toast("Записів немає");
    if (!(await ask("Видалити всі записи?", `Буде видалено ${pl(S.episodes.length, "запис", "записи", "записів")} і ${pl(S.okDays.length, "день", "дні", "днів")} без болю. Скасувати не можна. Перед цим збережи «Експорт JSON».`, "Видалити все", "Скасувати"))) return;
    try { await Store.wipe(); await reload(); toast("Усі записи видалено"); } catch (e) { fail(e); }
  });
  $("#delacc-btn").addEventListener("click", async () => {
    if (!(await ask("Видалити акаунт?", `Акаунт ${Store.user.email} і всі його записи буде видалено назавжди. Скасувати не можна.`, "Видалити акаунт", "Скасувати"))) return;
    try { await Store.deleteAccount(); S.episodes = []; S.okDays = []; go("auth"); authMsg("Акаунт видалено.", true); }
    catch (e) {
      // Функції delete_my_account ще немає в базі (міграцію 002 не застосовано) — нічого не видалено.
      if (/delete_my_account|PGRST202|could not find the function/i.test(String((e && (e.message || e.code)) || e))) toast("Видалення акаунта поки недоступне. Нічого не видалено.");
      else fail(e);
    }
  });

  /* ---------- імпорт ---------- */
  $("#import-btn").addEventListener("click", () => $("#import-file").click());
  // Помилка файлу: окремий лист, який не зникає сам.
  async function fileError(text, input) {
    if (await ask("Не вдалося прочитати файл", text, "Вибрати інший файл", "Закрити")) $(input).click();
  }
  let pending = [];
  $("#import-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    try {
      const rows = Tags.importNotion(await f.text());
      const skipped = rows.skipped || [];
      if (!rows.length) return fileError(`Не вдалося прочитати дату в жодному рядку (наприклад: «${skipped[0] || "—"}»). Підходять формати: ${Tags.DATE_FORMATS}.`, "#import-file");
      // Дубль — той самий день і той самий текст опису (два болі за день — нормально).
      const firstLine = (t) => String(t || "").split("\n")[0].trim().toLowerCase();
      const have = new Set(S.episodes.map((e) => dayKey(new Date(e.started_at)) + "|" + firstLine(e.note)));
      pending = rows.map((r) => ({ ...r, dup: have.has(dayKey(new Date(r.started_at)) + "|" + firstLine(r.note)) }));
      const fresh = pending.filter((r) => !r.dup).length;
      const dups = pending.length - fresh;
      $("#imp-sum").textContent = `Знайшов ${pl(pending.length, "запис", "записи", "записів")}. Нових: ${fresh}.`
        + (dups ? ` ${pl(dups, "запис уже є", "записи вже є", "записів уже є")} — їх пропущу.` : "")
        + (skipped.length ? ` Не вдалося прочитати дату в ${pl(skipped.length, "рядку", "рядках", "рядках")} (наприклад: «${skipped[0]}») — їх пропущу. Формати: ${Tags.DATE_FORMATS}.` : "");
      const tb = $("#imp-rows"); tb.innerHTML = "";
      pending.slice().reverse().forEach((r) => {
        const tr = document.createElement("tr"); if (r.dup) tr.className = "dup";
        const d = new Date(r.started_at);
        const tags = [...r.sides.map((x) => T.sides[x]), ...r.triggers.map((x) => T.triggers[x]), ...(r.nausea ? ["нудота"] : [])];
        [`${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`, T.onset[r.onset] || "—", r.intensity ?? "—", r.meds.map((m) => m.name).join(", ") || "—", tags.join(", ") || "—", (r.note || "").split("\n")[0]]
          .forEach((v, i) => { const td = document.createElement("td"); td.textContent = v; if (i === 5) td.className = "t"; tr.appendChild(td); });
        tb.appendChild(tr);
      });
      $("#imp-go").disabled = !fresh;
      $("#imp-go").textContent = fresh ? `Імпортувати ${fresh}` : "Немає нових записів";
      $("#imp-sheet").showModal();
    } catch (e) { fileError(e.message || "Файл не схожий на експорт з Notion.", "#import-file"); }
  });

  /* ---------- відновлення з JSON ---------- */
  $("#restore-btn").addEventListener("click", () => $("#restore-file").click());
  $("#restore-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); } catch { return fileError("Це не JSON-файл. Вибери файл nimb-….json з «Експорт JSON».", "#restore-file"); }
    if (!j || !Array.isArray(j.episodes)) return fileError("У файлі немає записів NIMB. Вибери файл nimb-….json з «Експорт JSON».", "#restore-file");
    const key = (e) => e.started_at + "|" + (e.note || "");
    const have = new Set(S.episodes.map(key));
    const eps = j.episodes.filter((e) => e && e.started_at && !have.has(key(e)));
    const oks = (j.ok_days || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !S.okDays.includes(d));
    if (!eps.length && !oks.length) return toast("Усі записи з файлу вже є");
    if (!(await ask("Відновити записи?", `Додам ${pl(eps.length, "запис", "записи", "записів")} і ${pl(oks.length, "день", "дні", "днів")} без болю. Те, що вже є, не зміниться.`, "Відновити", "Скасувати"))) return;
    try {
      if (eps.length) await Store.addMany(eps);
      for (const d of oks) await Store.markOk(d);
      await reload(); loadEnv(); toast("Відновлено");
    } catch (e) { fail(e); }
  });
  $("#imp-go").addEventListener("click", async () => {
    const btn = $("#imp-go"); busy(btn, true);
    try {
      const n = await Store.addMany(pending.filter((r) => !r.dup).map(({ dup, ...r }) => r));
      $("#imp-sheet").close(); await reload(); toast(`Імпортовано: ${pl(n, "запис", "записи", "записів")}`); loadEnv();
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
    if (!S.episodes.length && !S.okDays.length) return toast("Ще немає записів");
    const rows = [["type", "date", "start", "end", "duration_min", "onset", "intensity", "sides", "meds", "relief", "triggers", "nausea", "note", "source"]];
    const all = [...S.episodes.map((e) => ({ at: e.started_at, e })), ...S.okDays.map((d) => ({ at: d + "T12:00:00", ok: d }))].sort((a, b) => (a.at < b.at ? -1 : 1));
    all.forEach(({ e, ok }) => {
      if (ok) { rows.push(["без болю", ok, "", "", "", "", "", "", "", "", "", "", "", ""]); return; }
      const s = new Date(e.started_at);
      rows.push(["біль", dayKey(s), hm(e.started_at), e.ended_at ? `${dayKey(new Date(e.ended_at))} ${hm(e.ended_at)}` : "", e.ended_at ? Math.round((new Date(e.ended_at) - s) / 6e4) : "",
        T.onset[e.onset] || "", e.intensity ?? "", (e.sides || []).map((x) => T.sides[x] || x).join("; "),
        (e.meds || []).map((m) => `${m.name}${m.at ? " " + hm(m.at) : ""}`).join("; "), T.relief[e.relief] || "",
        (e.triggers || []).map((x) => T.triggers[x] || x).join("; "), e.nausea ? "так" : "", e.note || "", e.source || ""]);
    });
    download(`nimb-${stamp()}.csv`, Tags.toCSV(rows), "text/csv;charset=utf-8");
  });
  $("#exp-json").addEventListener("click", () => {
    if (!S.episodes.length && !S.okDays.length) return toast("Ще немає записів");
    download(`nimb-${stamp()}.json`, JSON.stringify({ app: "NIMB", version: NIMB_VERSION, exported_at: new Date().toISOString(), episodes: S.episodes.slice().reverse(), ok_days: S.okDays.slice().sort() }, null, 2), "application/json");
  });

  // Тап по дню в календарі.
  $("#heat").addEventListener("click", async (ev) => {
    const day = ev.target.dataset && ev.target.dataset.day; if (!day) return;
    const e = S.episodes.find((x) => dayKey(new Date(x.started_at)) === day);
    const d = new Date(day + "T12:00:00");
    if (e) return openSheet(e, { live: isLive(e) });
    if (S.okDays.includes(day)) {
      if (await ask("Прибрати відмітку?", `${dmy(d)} — день без болю. Прибрати цю відмітку?`, "Прибрати", "Залишити")) { await Store.unmarkOk(day).catch(fail); await reload(); }
      return;
    }
    const pick = await ask(`${dmy(d)}`, "На цей день немає запису.", "Записати біль", "Відмітити без болю");
    if (pick) { openSheet({ started_at: new Date(day + "T12:00:00").toISOString() }, { title: "Минулий епізод" }); }
    else if ($("#ask-sheet").dataset.choice === "no") { await Store.markOk(day).catch(fail); await reload(); toast("Відмічено день без болю"); }
  });

  /* ---------- зʼєднання ---------- */
  function renderNet() {
    const bar = $("#net-bar"), p = Store.pending;
    if (Store.mode !== "supabase" || (navigator.onLine && !Store.stale && !p)) { bar.hidden = true; return; }
    bar.textContent = !navigator.onLine
      ? "Немає зʼєднання. Нові записи збережуться тут і відправляться, коли зʼявиться інтернет." + (p ? ` Чекають: ${p}.` : "")
      : p ? `Відправляю зміни: ${p}…` : "Сервер недоступний. Показую збережені записи.";
    bar.hidden = false;
  }
  window.addEventListener("offline", renderNet);
  window.addEventListener("online", async () => { renderNet(); if (Store.mode === "supabase") { await Store.flush().catch(() => {}); await reload(); loadEnv(); } });

  /* ---------- старт ---------- */
  applyTheme(S.prefs.theme);
  window.addEventListener("resize", () => { if ($("#screen-stats").classList.contains("active")) renderStats(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Store.mode === "none") return;
    renderHome();
    if (Store.pending && navigator.onLine) Store.flush().then(reload, () => {});
  });
  if (Store.recovery) {
    // Відкрито посилання «новий пароль» з листа.
    go("reset");
    Store.recoverySession().then((ok) => { if (!ok) { go("auth"); authMsg("Посилання застаріло або вже використане. Попроси новий лист: «Забув пароль?»."); } });
  } else Store.init().then((mode) => (mode === "none" ? go("auth") : enter()));
})();
