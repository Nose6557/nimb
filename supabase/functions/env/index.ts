// env — дані довкілля по днях для однієї точки.
// Погода: Open-Meteo (archive + forecast). Повітря: Open-Meteo Air Quality.
// Магнітні бурі: GFZ Potsdam (історія, CC BY 4.0) + NOAA SWPC (останні дні й прогноз).
// Лише публічні дані: функція не бачить і не пише даних користувачів.
// Запит: /env?lat=50.45&lon=30.52&start=2025-04-01&end=2026-10-20

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (day: string, n: number) => iso(new Date(Date.parse(day + "T00:00:00Z") + n * 864e5));
const round = (x: number | null, k = 1) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** k) / 10 ** k);

type Acc = { sum: number; n: number; max: number; min: number };
const acc = (): Acc => ({ sum: 0, n: 0, max: -Infinity, min: Infinity });
function push(a: Acc, v: unknown) {
  const x = Number(v);
  if (v == null || !Number.isFinite(x)) return;
  a.sum += x; a.n++; if (x > a.max) a.max = x; if (x < a.min) a.min = x;
}
const mean = (a?: Acc) => (a && a.n ? a.sum / a.n : null);
const max = (a?: Acc) => (a && a.n ? a.max : null);
const range = (a?: Acc) => (a && a.n ? a.max - a.min : null);

// агрегати по днях: day -> поле -> Acc
const days = new Map<string, Record<string, Acc>>();
function add(day: string, key: string, v: unknown) {
  if (!days.has(day)) days.set(day, {});
  const r = days.get(day)!;
  if (!r[key]) r[key] = acc();
  push(r[key], v);
}

async function getJSON(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(new URL(url).host + " " + r.status + " " + (await r.text()).slice(0, 160));
  return r.json();
}

const HOURLY = "pressure_msl,temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m";
function eatWeather(j: any) {
  const h = j?.hourly;
  if (!h?.time) return;
  h.time.forEach((t: string, i: number) => {
    const day = t.slice(0, 10);
    add(day, "p", h.pressure_msl?.[i]);
    add(day, "t", h.temperature_2m?.[i]);
    add(day, "rh", h.relative_humidity_2m?.[i]);
    add(day, "pr", h.precipitation?.[i]);
    add(day, "w", h.wind_speed_10m?.[i]);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  days.clear();
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  const today = iso(new Date());
  let start = u.searchParams.get("start") || shift(today, -7);
  let end = u.searchParams.get("end") || shift(today, 3);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !DAY.test(start) || !DAY.test(end)) {
    return new Response(JSON.stringify({ error: "lat, lon, start, end (YYYY-MM-DD)" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (end > shift(today, 4)) end = shift(today, 4);
  if (start < shift(end, -1100)) start = shift(end, -1100);
  const from = shift(start, -1); // попередній день — для перепадів
  const errors: string[] = [];
  const loc = `latitude=${lat}&longitude=${lon}&timezone=auto`;

  // Погода. Архів відстає на кілька днів, тому свіже беремо з прогнозного API.
  const split = shift(today, -60);
  const jobs: Promise<void>[] = [];
  if (from < split) {
    const aEnd = end < split ? end : shift(split, -1);
    jobs.push(getJSON(`https://archive-api.open-meteo.com/v1/archive?${loc}&start_date=${from}&end_date=${aEnd}&hourly=${HOURLY}`).then(eatWeather).catch((e) => { errors.push(String(e)); }));
  }
  if (end >= split) {
    const fStart = from > split ? from : split;
    jobs.push(getJSON(`https://api.open-meteo.com/v1/forecast?${loc}&start_date=${fStart}&end_date=${end}&hourly=${HOURLY}`).then(eatWeather).catch((e) => { errors.push(String(e)); }));
  }
  // Повітря.
  jobs.push(getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${loc}&start_date=${from}&end_date=${end}&hourly=pm2_5,european_aqi`).then((j) => {
    const h = j?.hourly;
    h?.time?.forEach((t: string, i: number) => { add(t.slice(0, 10), "pm", h.pm2_5?.[i]); add(t.slice(0, 10), "aqi", h.european_aqi?.[i]); });
  }).catch((e) => { errors.push(String(e)); }));
  // Kp: історія з GFZ, свіже й прогноз з NOAA.
  const kpForecast = new Set<string>();
  if (from < today) {
    jobs.push(getJSON(`https://kp.gfz.de/app/json/?start=${from}T00:00:00Z&end=${end < today ? end : today}T23:59:59Z&index=Kp`).then((j) => {
      (j.datetime || []).forEach((t: string, i: number) => add(t.slice(0, 10), "kp", j.Kp?.[i]));
    }).catch((e) => { errors.push(String(e)); }));
  }
  jobs.push(getJSON("https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json").then((j) => {
    for (const row of j) {
      const t = String(Array.isArray(row) ? row[0] : row.time_tag);
      const kind = Array.isArray(row) ? row[2] : row.observed;
      if (!DAY.test(t.slice(0, 10))) continue;
      if (kind === "predicted") kpForecast.add(t.slice(0, 10));
      add(t.slice(0, 10), "kpn", Array.isArray(row) ? row[1] : row.kp);
    }
  }).catch((e) => { errors.push(String(e)); }));
  await Promise.all(jobs);

  const out = [];
  for (let d = start; d <= end; d = shift(d, 1)) {
    const r = days.get(d) || {};
    const prev = days.get(shift(d, -1)) || {};
    const p = mean(r.p), pPrev = mean(prev.p);
    const t = max(r.t), tPrev = max(prev.t);
    const kp = Math.max(max(r.kp) ?? -1, max(r.kpn) ?? -1);
    out.push({
      day: d,
      pressure_mean: round(p),
      pressure_delta: p != null && pPrev != null ? round(p - pPrev) : null,
      pressure_range: round(range(r.p)),
      temp_max: round(t),
      temp_delta: t != null && tPrev != null ? round(t - tPrev) : null,
      humidity_mean: round(mean(r.rh), 0),
      precip_sum: r.pr ? round(r.pr.sum) : null,
      wind_max: round(max(r.w)),
      pm25_mean: round(mean(r.pm)),
      aqi_max: round(max(r.aqi), 0),
      kp_max: kp >= 0 ? round(kp, 2) : null,
      forecast: d > today,
    });
  }
  return new Response(JSON.stringify({ lat, lon, days: out, errors, sources: "Open-Meteo.com (CC BY 4.0), GFZ Potsdam (CC BY 4.0), NOAA SWPC" }), {
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" },
  });
});
