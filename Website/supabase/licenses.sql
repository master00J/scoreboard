-- ArenaCue: licenties + installaties (activaties per machine)
-- Run in Supabase SQL Editor na demo_requests-schema.
-- Alleen de Next.js API gebruikt SUPABASE_SERVICE_ROLE_KEY; anon heeft geen toegang.

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  license_key text not null,
  organization_label text not null default '',
  max_activations int not null default 1,
  valid_until timestamptz,
  revoked_at timestamptz,
  plan text not null default 'standard',
  notes text,
  owner_email text,
  download_url text,
  constraint licenses_license_key_key unique (license_key),
  constraint licenses_max_activations_check check (max_activations >= 1 and max_activations <= 500),
  constraint licenses_plan_check check (plan in ('trial', 'standard', 'club', 'enterprise'))
);

create table if not exists public.license_installations (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses (id) on delete cascade,
  machine_id text not null,
  device_label text,
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint license_installations_machine_len check (char_length(machine_id) between 8 and 256),
  constraint license_installations_license_machine_key unique (license_id, machine_id)
);

create index if not exists licenses_license_key_idx on public.licenses (license_key);
create index if not exists license_installations_license_id_idx on public.license_installations (license_id);
create index if not exists license_installations_last_seen_idx on public.license_installations (last_seen_at desc);

alter table public.licenses enable row level security;
alter table public.license_installations enable row level security;

-- Geen policies: anon/authenticated krijgen geen directe tabeltoegang; service_role bypassed RLS.

-- Bestaande database: kolom voor klantportaal (e-mail moet matchen om status te tonen).
alter table public.licenses add column if not exists owner_email text;

create index if not exists licenses_owner_email_lower_idx
on public.licenses (lower(owner_email))
where owner_email is not null;

alter table public.licenses add column if not exists download_url text;

-- Voorbeeld: nieuwe licentie (pas sleutel en label aan)
-- insert into public.licenses (license_key, organization_label, owner_email, max_activations, valid_until, plan)
-- values ('DEMO-ARENA-001', 'Testclub', 'klant@voorbeeld.be', 3, null, 'trial');
