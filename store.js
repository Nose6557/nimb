/* store.js — єдиний шар доступу до даних.
   Два режими: Supabase (з акаунтом) або localStorage (гість).
   Решта коду знає лише про цей інтерфейс.

   Епізод:
   { id, started_at, ended_at, onset, intensity, sides[], meds[{name, at}], relief,
     triggers[], nausea, note, source }
*/
(function () {
  const cfg = window.NIMB_CONFIG || {};
  let sb = null;
  let mode = "none";            // "supabase" | "local" | "none"
  let user = null;
  const LS = "nimb_local_v1";
  const LS_GUEST = "nimb_guest";
  const LS_PREFS = "nimb_prefs";

  if (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_KEY) {
    try { sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY); } catch { sb = null; }
  }

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? d; } catch { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  function local() { return rd(LS, { episodes: [], ok_days: [] }); }
  function saveLocal(d) { wr(LS, d); }

  const COLS = "id,started_at,ended_at,onset,intensity,sides,meds,relief,triggers,nausea,note,source";
  function clean(e) {
    return {
      started_at: e.started_at, ended_at: e.ended_at || null, onset: e.onset || null,
      intensity: e.intensity == null || e.intensity === "" ? null : Number(e.intensity),
      sides: e.sides || [], meds: e.meds || [], relief: e.relief || null,
      triggers: e.triggers || [], nausea: !!e.nausea, note: e.note || null, source: e.source || "app",
    };
  }
  const byStart = (a, b) => (a.started_at < b.started_at ? 1 : -1);

  const Store = {
    get mode() { return mode; },
    get user() { return user; },
    get online() { return !!sb; },

    async init() {
      if (sb) {
        try {
          const { data } = await sb.auth.getSession();
          if (data && data.session) { user = data.session.user; mode = "supabase"; return mode; }
        } catch {}
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
    useGuest() { wr(LS_GUEST, true); mode = "local"; },
    async signOut() {
      if (sb && mode === "supabase") await sb.auth.signOut();
      user = null;
      if (mode === "local") { try { localStorage.removeItem(LS_GUEST); } catch {} }
      mode = "none";
    },
    // Гість створює акаунт → його записи переносяться в профіль.
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
      saveLocal({ episodes: [], ok_days: [] });
      try { localStorage.removeItem(LS_GUEST); } catch {}
      return n;
    },

    /* ---------- епізоди ---------- */
    async list() {
      if (mode === "supabase") {
        const { data, error } = await sb.from("episodes").select(COLS).order("started_at", { ascending: false }).limit(5000);
        if (error) throw error;
        return data;
      }
      return local().episodes.slice().sort(byStart);
    },
    async add(e) {
      const row = clean(e);
      if (mode === "supabase") {
        const { data, error } = await sb.from("episodes").insert(row).select(COLS).single();
        if (error) throw error;
        return data;
      }
      const d = local(); const r = { id: uid(), ...row }; d.episodes.push(r); saveLocal(d); return r;
    },
    async addMany(list) {
      const rows = list.map(clean);
      if (mode === "supabase") {
        for (let i = 0; i < rows.length; i += 200) {
          const { error } = await sb.from("episodes").insert(rows.slice(i, i + 200));
          if (error) throw error;
        }
        return rows.length;
      }
      const d = local(); rows.forEach((r) => d.episodes.push({ id: uid(), ...r })); saveLocal(d); return rows.length;
    },
    async update(id, patch) {
      const row = clean(patch);
      if (mode === "supabase") {
        const { data, error } = await sb.from("episodes").update(row).eq("id", id).select(COLS).single();
        if (error) throw error;
        return data;
      }
      const d = local(); const i = d.episodes.findIndex((x) => x.id === id);
      if (i >= 0) d.episodes[i] = { ...d.episodes[i], ...row };
      saveLocal(d); return d.episodes[i];
    },
    async remove(id) {
      if (mode === "supabase") {
        const { error } = await sb.from("episodes").delete().eq("id", id);
        if (error) throw error; return;
      }
      const d = local(); d.episodes = d.episodes.filter((x) => x.id !== id); saveLocal(d);
    },

    /* ---------- дні без болю ---------- */
    async okDays() {
      if (mode === "supabase") {
        const { data, error } = await sb.from("ok_days").select("day").limit(5000);
        if (error) throw error;
        return data.map((r) => r.day);
      }
      return local().ok_days.slice();
    },
    async markOk(day) {
      if (mode === "supabase") {
        const { error } = await sb.from("ok_days").upsert({ day }, { onConflict: "user_id,day", ignoreDuplicates: true });
        if (error) throw error; return;
      }
      const d = local(); if (!d.ok_days.includes(day)) d.ok_days.push(day); saveLocal(d);
    },
    async unmarkOk(day) {
      if (mode === "supabase") { await sb.from("ok_days").delete().eq("day", day); return; }
      const d = local(); d.ok_days = d.ok_days.filter((x) => x !== day); saveLocal(d);
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
