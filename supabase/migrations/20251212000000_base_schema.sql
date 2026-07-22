-- TrendSync core schema.
-- This migration supplies the tables that predate the original incremental
-- migrations, so a new Supabase project can be deployed from this repository.

create extension if not exists pgcrypto;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_styles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  version integer not null default 1,
  style_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  season text not null default '',
  region text not null default '',
  target_demographic text not null default '',
  status text not null default 'draft',
  collection_plan_json jsonb not null default '{}'::jsonb,
  trend_insights_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_status_check check (status in ('draft', 'generating', 'validating', 'complete', 'failed'))
);

create table if not exists public.collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  sku text not null,
  name text not null,
  category text not null,
  subcategory text not null default '',
  design_story text not null default '',
  target_persona text not null default '',
  price_tier text not null default 'mid',
  design_spec_json jsonb not null default '{}'::jsonb,
  fibo_prompt_json jsonb not null default '{}'::jsonb,
  brand_compliance_score numeric(5,2) not null default 0,
  status text not null default 'planned',
  image_url text,
  video_url text,
  techpack_json jsonb,
  techpack_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_items_category_check check (category in ('apparel', 'footwear', 'accessories')),
  constraint collection_items_price_tier_check check (price_tier in ('entry', 'mid', 'premium', 'luxury')),
  constraint collection_items_status_check check (status in ('planned', 'designing', 'generating', 'validating', 'complete', 'failed'))
);

create table if not exists public.trend_insights (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.collections(id) on delete cascade,
  region text not null default '',
  season text not null default '',
  demographic text not null default '',
  insights_json jsonb not null default '{}'::jsonb,
  source text not null default 'openai-web-search',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.generated_images (
  id uuid primary key default gen_random_uuid(),
  collection_item_id uuid not null references public.collection_items(id) on delete cascade,
  image_url text not null,
  image_type text not null default 'product',
  view_angle text not null default 'front',
  generation_params_json jsonb not null default '{}'::jsonb,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tech_packs (
  id uuid primary key default gen_random_uuid(),
  collection_item_id uuid not null references public.collection_items(id) on delete cascade,
  version integer not null default 1,
  tech_pack_json jsonb not null default '{}'::jsonb,
  pdf_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tech_packs_status_check check (status in ('draft', 'review', 'approved'))
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint generation_jobs_status_check check (status in ('queued', 'processing', 'complete', 'failed'))
);

create table if not exists public.login_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  login_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  login_method text not null default 'password',
  success boolean not null default true
);

create index if not exists brands_user_id_idx on public.brands(user_id);
create index if not exists brand_styles_brand_id_idx on public.brand_styles(brand_id);
create index if not exists collections_brand_id_idx on public.collections(brand_id);
create index if not exists collection_items_collection_id_idx on public.collection_items(collection_id);
create index if not exists trend_insights_collection_id_idx on public.trend_insights(collection_id);
create index if not exists generated_images_collection_item_id_idx on public.generated_images(collection_item_id);
create index if not exists tech_packs_collection_item_id_idx on public.tech_packs(collection_item_id);
create index if not exists generation_jobs_user_id_idx on public.generation_jobs(user_id);
create index if not exists login_audit_user_id_idx on public.login_audit(user_id);

alter table public.brands enable row level security;
alter table public.brand_styles enable row level security;
alter table public.collections enable row level security;
alter table public.collection_items enable row level security;
alter table public.trend_insights enable row level security;
alter table public.generated_images enable row level security;
alter table public.tech_packs enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.login_audit enable row level security;
