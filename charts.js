/* charts.js — прості графіки на SVG без бібліотек. Кольори беруть токени теми. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const MON = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
  const monLabel = (k) => MON[+k.slice(5) - 1] + " ’" + k.slice(2, 4);

  // rows: [{key:'2026-05', a:8, b:4}] — стовпчики a, точки b
  function months(box, rows) {
    box.innerHTML = "";
    if (!rows.length) { box.innerHTML = '<p class="empty">Ще немає записів</p>'; return; }
    const W = Math.max(box.clientWidth || 320, 260), H = 200;
    const m = { t: 10, r: 4, b: 26, l: 24 };
    const max = Math.max(1, ...rows.map((r) => r.a));
    const ticks = max <= 4 ? [0, 2, 4] : [0, Math.ceil(max / 2), Math.ceil(max / 2) * 2];
    const top = ticks[ticks.length - 1] || 1;
    const y = (v) => m.t + (H - m.t - m.b) * (1 - v / top);
    const step = (W - m.l - m.r) / rows.length;
    const bw = Math.min(28, step * 0.62);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Епізоди по місяцях" }, box);
    ticks.forEach((t) => {
      el("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--chart-grid)" }, svg);
      const tx = el("text", { x: m.l - 6, y: y(t) + 4, "text-anchor": "end" }, svg); tx.textContent = t;
    });
    const every = Math.ceil(rows.length / Math.max(3, Math.floor(W / 64)));
    const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; box.appendChild(tip);
    rows.forEach((r, i) => {
      const cx = m.l + step * i + step / 2;
      const h = y(0) - y(r.a);
      const bar = el("rect", { x: cx - bw / 2, y: y(r.a), width: bw, height: Math.max(0, h), rx: Math.min(6, bw / 2), fill: "var(--accent)", opacity: ".9" }, svg);
      if (r.b) el("circle", { cx, cy: y(r.b), r: 3.5, fill: "var(--risk-mid)", stroke: "var(--surface)", "stroke-width": 1.5 }, svg);
      if (i % every === 0) { const t = el("text", { x: cx, y: H - 6, "text-anchor": "middle" }, svg); t.textContent = monLabel(r.key); }
      const hit = el("rect", { x: cx - step / 2, y: m.t, width: step, height: H - m.t - m.b, fill: "transparent" }, svg);
      const show = (ev) => {
        svg.querySelectorAll("rect[fill='var(--accent)']").forEach((b) => b.setAttribute("opacity", b === bar ? "1" : ".45"));
        tip.innerHTML = "";
        const a = document.createElement("div"); a.className = "t"; a.textContent = monLabel(r.key);
        const b = document.createElement("div"); b.textContent = `Епізоди: ${r.a}`;
        const c = document.createElement("div"); c.textContent = `Дні з таблеткою: ${r.b}`;
        tip.append(a, b, c); tip.hidden = false;
        const bx = box.getBoundingClientRect();
        const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - bx.left;
        tip.style.left = Math.max(0, Math.min(px + 10, bx.width - tip.offsetWidth)) + "px";
        tip.style.top = "0px";
      };
      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", () => { tip.hidden = true; svg.querySelectorAll("rect[fill='var(--accent)']").forEach((b) => b.setAttribute("opacity", ".9")); });
    });
  }

  // rows: [{label, n, muted?}]
  function hbars(box, rows, fmt) {
    box.innerHTML = "";
    const max = Math.max(1, ...rows.map((r) => r.n));
    const top = Math.max(...rows.map((r) => r.n));
    if (!rows.some((r) => r.n)) { box.innerHTML = '<p class="small muted">Немає даних</p>'; return; }
    rows.forEach((r) => {
      const row = document.createElement("div"); row.className = "hbar";
      const l = document.createElement("span"); l.textContent = r.label;
      const t = document.createElement("div"); t.className = "hbar-track";
      const f = document.createElement("div"); f.className = "hbar-fill" + (r.muted ? " muted" : "");
      if (!r.muted && r.n !== top) f.style.opacity = ".5";
      f.style.width = (r.n / max) * 100 + "%";
      t.appendChild(f);
      const v = document.createElement("span"); v.className = "v"; v.textContent = fmt ? fmt(r) : r.n;
      row.append(l, t, v); box.appendChild(row);
    });
  }

  // days: Map day -> level ('ok'|'l1'|'l2'|'l3'), weeks: скільки тижнів показати
  function heat(box, days, weeks, dayKey) {
    box.innerHTML = "";
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + (7 - ((end.getDay() + 6) % 7) - 1)); // неділя цього тижня
    const start = new Date(end); start.setDate(start.getDate() - weeks * 7 + 1);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const i = document.createElement("i");
      const k = dayKey(d);
      if (d > now) i.className = "out";
      else if (days.has(k)) i.className = days.get(k);
      i.title = k;
      box.appendChild(i);
    }
    box.scrollLeft = box.scrollWidth;
  }

  window.Charts = { months, hbars, heat, monLabel };
})();
