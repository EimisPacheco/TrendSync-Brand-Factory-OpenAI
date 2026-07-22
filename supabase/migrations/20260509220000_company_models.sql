-- Company Models Catalog — shared across all brands.
-- Used by the new "Company Models" tab and the ModelSelectionModal that
-- appears before ad/product video generation.

create table if not exists public.company_models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  image_url   text not null,
  attributes  jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists company_models_created_at_idx
  on public.company_models (created_at desc);

-- Public catalog: any authenticated visitor can read; only authenticated
-- users can insert / delete (good enough for a hackathon demo, mirrors the
-- "shared across brands" requirement). Tighten later if multi-tenancy is added.
alter table public.company_models enable row level security;

create policy "company_models read"
  on public.company_models for select
  to authenticated, anon
  using (true);

create policy "company_models insert"
  on public.company_models for insert
  to authenticated, anon
  with check (true);

create policy "company_models delete"
  on public.company_models for delete
  to authenticated, anon
  using (true);
