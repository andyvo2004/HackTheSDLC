alter table public.payment_pages
  add column if not exists owner_user_id text references public.admin_users(id) on delete set null;

create index if not exists idx_payment_pages_owner_user_id
  on public.payment_pages(owner_user_id);

with first_owner as (
  select id
  from public.admin_users
  where role = 'owner'
  order by created_at asc
  limit 1
)
update public.payment_pages
set owner_user_id = (select id from first_owner)
where owner_user_id is null
  and exists (select 1 from first_owner);
