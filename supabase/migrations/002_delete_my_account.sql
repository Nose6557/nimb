-- 002_delete_my_account — людина видаляє свій акаунт з налаштувань застосунку.
-- Функція видаляє лише рядок поточного користувача в auth.users.
-- Його episodes, ok_days, profiles, env_daily зникають каскадом (on delete cascade).

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end; $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
