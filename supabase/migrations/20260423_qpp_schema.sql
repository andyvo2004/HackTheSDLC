create table if not exists public.admin_users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  role text not null default 'owner' check (role in ('viewer', 'editor', 'owner')),
  company_name text,
  company_logo_url text,
  created_at text not null
);

create table if not exists public.payment_pages (
  id text primary key,
  owner_user_id text references public.admin_users(id) on delete set null,
  slug text unique not null,
  title text not null,
  subtitle text,
  description text,
  logo_url text,
  brand_color text,
  header_message text,
  footer_message text,
  amount_mode text not null check (amount_mode in ('fixed', 'range', 'user_entered')),
  fixed_amount real,
  min_amount real,
  max_amount real,
  gl_codes_json text not null default '[]',
  email_template text,
  draft_config_json text,
  current_version integer not null default 1,
  last_published_at text,
  is_active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

create table if not exists public.payment_page_versions (
  id text primary key,
  page_id text not null references public.payment_pages(id) on delete cascade,
  version_number integer not null,
  config_json text not null,
  published_by text,
  created_at text not null
);

create table if not exists public.custom_fields (
  id text primary key,
  page_id text not null references public.payment_pages(id) on delete cascade,
  label text not null,
  type text not null check (type in ('text', 'number', 'dropdown', 'date', 'checkbox')),
  options_json text,
  required integer not null default 0,
  placeholder text,
  helper_text text,
  display_order integer not null default 0
);

create table if not exists public.transactions (
  id text primary key,
  page_id text not null references public.payment_pages(id),
  amount real not null,
  payment_method text not null,
  status text not null check (status in ('success', 'failed', 'pending')),
  payer_name text,
  payer_email text,
  processor_ref text,
  stripe_payment_intent_id text,
  gl_codes_json text not null default '[]',
  created_at text not null
);

create table if not exists public.field_responses (
  id text primary key,
  transaction_id text not null references public.transactions(id) on delete cascade,
  field_id text not null references public.custom_fields(id),
  value text
);

create table if not exists public.page_views (
  id text primary key,
  page_id text not null references public.payment_pages(id) on delete cascade,
  visited_at text not null
);

create table if not exists public.webhook_events (
  id text not null,
  processor text not null,
  event_type text not null,
  payment_intent_id text,
  received_at text not null,
  primary key (processor, id)
);

create unique index if not exists idx_transactions_stripe_intent_id on public.transactions(stripe_payment_intent_id);
create index if not exists idx_payment_pages_owner_user_id on public.payment_pages(owner_user_id);
