-- 001_init — таблиці NIMB. Уже виконано в проєкті Supabase «Headache Diary».
-- Кожна таблиця під RLS: користувач бачить і змінює лише свої рядки.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  location_mode text not null default 'auto' check (location_mode in ('auto','manual')),
  city text, lat double precision, lon double precision,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  onset text check (onset in ('night','morning','day','evening')),
  intensity smallint check (intensity between 0 and 10),
  sides text[] not null default '{}',
  meds jsonb not null default '[]'::jsonb,           -- [{name, at}]
  relief text check (relief in ('yes','partial','no')),
  triggers text[] not null default '{}',
  nausea boolean not null default false,
  note text,
  source text not null default 'app' check (source in ('app','import')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index episodes_user_started on public.episodes (user_id, started_at desc);

create table public.ok_days (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null, primary key (user_id, day)
);

-- Заготовка під щоденний збір погоди на сервері (етап «сповіщення»). Зараз клієнт кешує дані сам.
create table public.env_daily (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null, lat double precision, lon double precision,
  pressure_mean real, pressure_delta real, temp_max real, temp_delta real, humidity_mean real,
  precip_sum real, wind_max real, pm25_mean real, aqi_max real, kp_max real,
  fetched_at timestamptz not null default now(), primary key (user_id, day)
);

alter table public.profiles enable row level security;
alter table public.episodes enable row level security;
alter table public.ok_days enable row level security;
alter table public.env_daily enable row level security;

create policy "own profile" on public.profiles for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own episodes" on public.episodes for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own ok days" on public.ok_days for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own env" on public.env_daily for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create trigger episodes_touch before update on public.episodes for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id) values (new.id) on conflict do nothing; return new; end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
