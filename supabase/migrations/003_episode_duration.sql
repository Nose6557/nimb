-- Версія 7: тривалість болю — приблизна і необов'язкова. Кнопки «Минуло» більше немає.
-- ended_at лишається для старих записів з точним кінцем.
alter table public.episodes
  add column if not exists duration text check (duration in ('lt1','h1_4','h4_24','day'));
