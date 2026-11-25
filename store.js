/* store.js — єдиний шар доступу до даних.
   Два режими: Supabase (з акаунтом) або localStorage (гість).
   Решта коду знає лише про цей інтерфейс.

   Епізод:
   { id, started_at, ended_at, duration, onset, intensity, sides[], meds[{name, at}], relief,
     triggers[], nausea, note, source, created_at }

   Офлайн (режим Supabase): останній список записів лежить у браузері (кеш).
   Зміни без інтернету стають у чергу і відправляються, коли зʼєднання повернеться. */
(function () {
  const cfg = window.NIMB_CONFIG || {};
  let sb = null;
  let mode = "none";            // "supabase" | "local" | "none"
  let user = null;
  let stale = false;            // true — показуємо кеш, бо сервер недоступний
  const LS = "nimb_local_v1";
  const LS_GUEST = "nimb_guest";
  const LS_PREFS = "nimb_prefs";
  // Посилання з листа «новий пароль» приходить з #...type=recovery. Ловимо до того, як клієнт очистить адресу.
  const recovery = /type=recovery/.test(location.hash);

  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_KEY) {
    try { sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY); } catch { sb = null; }
  }
  const AUTH_KEY = cfg.SUPABASE_URL ? `sb-${new URL(cfg.SUPABASE_URL).hostname.split(".")[0]}-auth-token` : "";

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function local() { return rd(LS, { episodes: [], ok_days: [] }); }
  function saveLocal(d) { wr(LS, d); }

  // Кеш і черга — окремо для кожного акаунта.
  const kCache = () => "nimb_cache_" + user.id;
  const kQueue = () => "nimb_queue_" + user.id;
  const cache = () => rd(kCache(), { episodes: [], ok_days: [] });
  const saveCache = (c) => wr(kCache(), c);
  const queue = () => rd(kQueue(), []);
  const saveQueue = (q) => wr(kQueue(), q);
  // Помилка мережі (а не помилка даних)?
  const isNet = (e) => !navigator.onLine || e instanceof TypeError || /fetch|network|load failed|timeout/i.test(String(e && e.message));
  const must = ({ data, error }) => { if (error) throw error; return data; };

  const COLS = "id,started_at,ended_at,duration,onset,intensity,sides,meds,relief,triggers,nausea,note,source,created_at";
  function clean(e) {
    return {
      started_at: e.started_at, ended_at: e.ended_at || null, duration: e.duration || null, onset: e.onset || null,
      intensity: e.intensity == null || e.intensity === "" ? null : Number(e.intensity),
      sides: e.sides || [], meds: e.meds || [], relief: e.relief || null,
      triggers: e.triggers || [], nausea: !!e.nausea, note: e.note || null, source: e.source || "app",
    };
  }
  const byStart = (a, b) => (a.started_at < b.started_at ? 1 : -1);

  // Застосувати зміну до кешу (щоб екран одразу показував її і офлайн).
  function cacheApply(fn) { const c = cache(); fn(c); saveCache(c); }

  // Відправити чергу. Повертає кількість відправлених змін. Зупиняється на першій помилці мережі.
  let flushing = null;
  async function flush() {
    if (mode !== "supabase" || !sb) return 0;
    if (flushing) return flushing;
    flushing = (async () => {
      let q = queue(), sent = 0;
      while (q.length) {
        const op = q[0];
        try {
          if (op.op === "add") {
            const row = must(await sb.from("episodes").insert(op.row).select(COLS).single());
            cacheApply((c) => { const i = c.episodes.findIndex((x) => x.id === op.tmp); if (i >= 0) c.episodes[i] = row; });
          } else if (op.op === "update") must(await sb.from("episodes").update(op.row).eq("id", op.id));
          else if (op.op === "remove") must(await sb.from("episodes").delete().eq("id", op.id));
          else if (op.op === "ok") must(await sb.from("ok_days").upsert({ day: op.day }, { onConflict: "user_id,day", ignoreDuplicates: true }));
          else if (op.op === "unok") must(await sb.from("ok_days").delete().eq("day", op.day));
        } catch (e) {
          if (isNet(e)) break;
          console.error("Зміну з черги відхилено", op, e); // помилка даних — пропускаємо, щоб черга не застрягла
        }
        q = queue(); q.shift(); saveQueue(q); sent++;
      }
      return sent;
    })();
    try { return await flushing; } finally { flushing = null; }
  }

  const Store = {
    get mode() { return mode; },
    get user() { return user; },
    get online() { return !!sb; },
    get stale() { return stale; },
    get recovery() { return recovery; },
    get pending() { return mode === "supabase" ? queue().length : 0; },
    flush,

    async init() {
      if (sb) {
        try {
          const { data } = await sb.auth.getSession();
          if (data && data.session) { user = data.session.user; mode = "supabase"; return mode; }
        } catch {}
      }
      // Офлайн або сервер недоступний: беремо збережену сесію, щоб не викидати людину на екран входу.
      if (!navigator.onLine || !sb) {
        const s = rd(AUTH_KEY, null);
        const u = s && (s.user || (s.currentSession && s.currentSession.user));
        if (u && u.id) { user = u; mode = "supabase"; return mode; }
      }
      if (rd(LS_GUEST, false)) mode = "local";
      return mode;
    },
    async signIn(email, password) {
      if (!sb) throw new Error("Немає з'єднання з сервером. Спробуй гостьовий режим.");
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      user = data.user; mode = "supabase"; return user;
    },
    async signUp(email, password) {
      if (!sb) throw new Error("Немає з'єднання з сервером. Спробуй гостьовий режим.");
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (data.session) { user = data.user; mode = "supabase"; }
      return { needsConfirm: !data.session };
    },
    async resetPassword(email) {
      if (!sb) throw new Error("Немає з'єднання з сервером.");
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { data, error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      user = data.user; mode = "supabase";
    },
    // Сесія з посилання «новий пароль» (клієнт розбирає адресу сам, трохи пізніше за init).
    async recoverySession() {
      for (let i = 0; i < 20; i++) {
        const { data } = await sb.auth.getSession();
        if (data && data.session) { user = data.session.user; mode = "supabase"; return true; }
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },
    useGuest() { wr(LS_GUEST, true); mode = "local"; },
    async signOut() {
      if (sb && mode === "supabase") {
        try { await sb.auth.signOut(); } catch {}
        // Записи не лишаються в браузері після виходу.
        try { localStorage.removeItem(kCache()); localStorage.removeItem(kQueue()); } catch {}
      }
      user = null;
      if (mode === "local") { try { localStorage.removeItem(LS_GUEST); } catch {} }
      mode = "none";
    },
    // Скільки записів гостя лежить у браузері (до переносу в акаунт).
    guestCount() { const d = local(); return d.episodes.length + d.ok_days.length; },
    clearGuest() { saveLocal({ episodes: [], ok_days: [] }); try { localStorage.removeItem(LS_GUEST); } catch {} },
    // Гість створює акаунт → його записи переносяться в профіль. Викликати лише після згоди людини.
    async migrateGuest() {
      if (mode !== "supabase") return 0;
      const d = local();
      if (!d.episodes.length && !d.ok_days.length) return 0;
      if (d.episodes.length) {
        const { error } = await sb.from("episodes").insert(d.episodes.map(clean));
        if (error) throw error;
      }
      if (d.ok_days.length) await sb.from("ok_days").upsert(d.ok_days.map((day) => ({ day })), { onConflict: "user_id,day", ignoreDuplicates: true });
      const n = d.episodes.length;
      this.clearGuest();
      return n;
    },

    /* ---------- епізоди ---------- */
    async list() {
      if (mode === "supabase") {
        await flush().catch(() => {});
        try {
          const data = must(await sb.from("episodes").select(COLS).order("started_at", { ascending: false }).limit(5000));
          // Записи з черги, ще не відправлені, лишаються видимими.
          const tmp = cache().episodes.filter((e) => String(e.id).startsWith("tmp-"));
          const all = [...tmp, ...data].sort(byStart);
          cacheApply((c) => { c.episodes = all; });
          stale = queue().length > 0;
          return all;
        } catch (e) {
          if (!isNet(e)) throw e;
          stale = true;
          return cache().episodes.slice().sort(byStart);
        }
      }
      return local().episodes.slice().sort(byStart);
    },
    async add(e) {
      const row = clean(e);
      if (mode === "supabase") {
        try {
          const data = must(await sb.from("episodes").insert(row).select(COLS).single());
          cacheApply((c) => c.episodes.unshift(data));
          return data;
        } catch (err) {
          if (!isNet(err)) throw err;
          const r = { id: "tmp-" + uid(), created_at: new Date().toISOString(), ...row };
          saveQueue([...queue(), { op: "add", tmp: r.id, row }]);
          cacheApply((c) => c.episodes.unshift(r));
          stale = true;
          return r;
        }
      }
      const d = local(); const r = { id: uid(), created_at: new Date().toISOString(), ...row }; d.episodes.push(r); saveLocal(d); return r;
    },
    async addMany(list) {
      const rows = list.map(clean);
      if (mode === "supabase") {
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from("episodes").insert(rows.slice(i, i + 200));
          if (error) throw isNet(error) ? new Error("Немає інтернету. Імпорт потребує зʼєднання — спробуй пізніше.") : error;
        }
        return rows.length;
      }
      const now = new Date().toISOString();
      const d = local(); rows.forEach((r) => d.episodes.push({ id: uid(), created_at: now, ...r })); saveLocal(d); return rows.length;
    },
    async update(id, patch) {
      const row = clean(patch);
      if (mode === "supabase") {
        const put = () => cacheApply((c) => { const i = c.episodes.findIndex((x) => x.id === id); if (i >= 0) c.episodes[i] = { ...c.episodes[i], ...row }; });
        if (String(id).startsWith("tmp-")) { // ще в черзі — міняємо сам запис у черзі
          saveQueue(queue().map((o) => (o.op === "add" && o.tmp === id ? { ...o, row } : o))); put(); return { id, ...row };
        }
        try {
          const data = must(await sb.from("episodes").update(row).eq("id", id).select(COLS).single());
          put(); return data;
        } catch (err) {
          if (!isNet(err)) throw err;
          saveQueue([...queue(), { op: "update", id, row }]); put(); stale = true; return { id, ...row };
        }
      }
      const d = local(); const i = d.episodes.findIndex((x) => x.id === id);
      if (i >= 0) d.episodes[i] = { ...d.episodes[i], ...row };
      saveLocal(d); return d.episodes[i];
    },
    async remove(id) {
      if (mode === "supabase") {
        const drop = () => cacheApply((c) => { c.episodes = c.episodes.filter((x) => x.id !== id); });
        if (String(id).startsWith("tmp-")) { saveQueue(queue().filter((o) => o.tmp !== id)); drop(); return; }
        try { must(await sb.from("episodes").delete().eq("id", id)); drop(); }
        catch (err) { if (!isNet(err)) throw err; saveQueue([...queue(), { op: "remove", id }]); drop(); stale = true; }
        return;
      }
      const d = local(); d.episodes = d.episodes.filter((x) => x.id !== id); saveLocal(d);
    },

    /* ---------- дні без болю ---------- */
    async okDays() {
      if (mode === "supabase") {
        try {
          const days = must(await sb.from("ok_days").select("day").limit(5000)).map((r) => r.day);
          // відмітки з черги
          let out = days;
          queue().forEach((o) => {
            if (o.op === "ok" && !out.includes(o.day)) out = [...out, o.day];
            if (o.op === "unok") out = out.filter((d) => d !== o.day);
          });
          cacheApply((c) => { c.ok_days = out; });
          return out;
        } catch (e) {
          if (!isNet(e)) throw e;
          stale = true; return cache().ok_days.slice();
        }
      }
      return local().ok_days.slice();
    },
    async markOk(day) {
      if (mode === "supabase") {
        cacheApply((c) => { if (!c.ok_days.includes(day)) c.ok_days.push(day); });
        try { must(await sb.from("ok_days").upsert({ day }, { onConflict: "user_id,day", ignoreDuplicates: true })); }
        catch (err) { if (!isNet(err)) throw err; saveQueue([...queue(), { op: "ok", day }]); stale = true; }
        return;
      }
      const d = local(); if (!d.ok_days.includes(day)) d.ok_days.push(day); saveLocal(d);
    },
    async unmarkOk(day) {
      if (mode === "supabase") {
        cacheApply((c) => { c.ok_days = c.ok_days.filter((x) => x !== day); });
        try { must(await sb.from("ok_days").delete().eq("day", day)); }
        catch (err) { if (!isNet(err)) throw err; saveQueue([...queue(), { op: "unok", day }]); stale = true; }
        return;
      }
      const d = local(); d.ok_days = d.ok_days.filter((x) => x !== day); saveLocal(d);
    },

    /* ---------- видалення ---------- */
    // Усі записи й дні без болю. Акаунт лишається.
    async wipe() {
      if (mode === "supabase") {
        must(await sb.from("episodes").delete().eq("user_id", user.id));
        must(await sb.from("ok_days").delete().eq("user_id", user.id));
        saveQueue([]); saveCache({ episodes: [], ok_days: [] });
        return;
      }
      saveLocal({ episodes: [], ok_days: [] });
    },
    // Акаунт разом з усіма даними (функція delete_my_account у базі видаляє лише себе).
    async deleteAccount() {
      if (mode !== "supabase") return;
      must(await sb.rpc("delete_my_account"));
      try { localStorage.removeItem(kCache()); localStorage.removeItem(kQueue()); } catch {}
      try { await sb.auth.signOut({ scope: "local" }); } catch {}
      user = null; mode = "none";
    },

    /* ---------- налаштування: тема й місце ----------
       Живуть у браузері (щоб тема ставилась до першого малювання)
       і дублюються в профіль акаунта, щоб переїжджати на інший пристрій. */
    prefs() { return { theme: "system", location_mode: "auto", place: null, ...rd(LS_PREFS, {}) }; },
    async setPrefs(patch) {
      const p = { ...this.prefs(), ...patch };
      wr(LS_PREFS, p);
      if ("theme" in patch) { try { localStorage.setItem("nimb_theme", p.theme); } catch {} }
      if (mode === "supabase") {
        const row = { id: user.id, theme: p.theme, location_mode: p.location_mode };
        if (p.place) Object.assign(row, { city: p.place.name || null, lat: p.place.lat, lon: p.place.lon });
        sb.from("profiles").upsert(row).then(() => {}, () => {});
      }
      return p;
    },
    async pullPrefs() {
      if (mode !== "supabase") return this.prefs();
      const { data } = await sb.from("profiles").select("theme,location_mode,city,lat,lon").eq("id", user.id).maybeSingle();
      if (!data) return this.prefs();
      const patch = { theme: data.theme, location_mode: data.location_mode };
      if (data.location_mode === "manual" && data.lat != null) patch.place = { name: data.city, lat: data.lat, lon: data.lon };
      wr(LS_PREFS, { ...this.prefs(), ...patch });
      try { localStorage.setItem("nimb_theme", patch.theme); } catch {}
      return this.prefs();
    },
  };

  window.Store = Store;
})();
