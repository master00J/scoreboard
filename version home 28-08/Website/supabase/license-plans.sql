-- ArenaCue: beheerbare licentieplannen + feature flags
-- Run dit in Supabase SQL Editor na licenses.sql.

create table if not exists public.license_plans (
  code text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  description text,
  price_label text,
  features jsonb not null default '{}'::jsonb,
  max_activations_default int not null default 1,
  active boolean not null default true,
  sort_order int not null default 100,
  constraint license_plans_code_check check (code ~ '^[a-z0-9_-]{2,40}$'),
  constraint license_plans_max_activations_default_check check (
    max_activations_default >= 1 and max_activations_default <= 500
  ),
  constraint license_plans_features_object_check check (jsonb_typeof(features) = 'object')
);

alter table public.license_plans enable row level security;

-- Dynamische plannen: bestaande enum/check op licenses.plan mag niet langer beperken.
alter table public.licenses drop constraint if exists licenses_plan_check;

create index if not exists license_plans_active_sort_idx
on public.license_plans (active desc, sort_order asc, code asc);

insert into public.license_plans
  (code, name, description, price_label, max_activations_default, sort_order, features)
values
  (
    'trial',
    'Demo',
    'Tijdelijke demo met alle belangrijke wedstrijdfuncties om ArenaCue goed te testen.',
    'Demo',
    2,
    10,
    '{
      "scoreboard": true,
      "manual_media": true,
      "automatic_sponsor_rotation": true,
      "sponsor_budget_tracking": true,
      "sponsor_interrupt_resume": true,
      "proof_of_play_export": true,
      "video_assets": true,
      "player_intros": true,
      "led_boarding": false,
      "cloud_control": false,
      "mobile_control": true,
      "multi_device": true
    }'::jsonb
  ),
  (
    'starter',
    'Starter',
    'Voor clubs die scorebord en media manueel door een operator willen bedienen.',
    'Vanaf prijs op aanvraag',
    1,
    20,
    '{
      "scoreboard": true,
      "manual_media": true,
      "automatic_sponsor_rotation": false,
      "sponsor_budget_tracking": false,
      "sponsor_interrupt_resume": false,
      "proof_of_play_export": false,
      "video_assets": true,
      "player_intros": false,
      "led_boarding": false,
      "cloud_control": false,
      "mobile_control": false,
      "multi_device": false
    }'::jsonb
  ),
  (
    'standard',
    'Essential',
    'Basislicentie met scorebord, handmatige media en beperkte sponsorfunctionaliteit.',
    'Prijs op aanvraag',
    1,
    30,
    '{
      "scoreboard": true,
      "manual_media": true,
      "automatic_sponsor_rotation": false,
      "sponsor_budget_tracking": false,
      "sponsor_interrupt_resume": false,
      "proof_of_play_export": false,
      "video_assets": true,
      "player_intros": false,
      "led_boarding": false,
      "cloud_control": false,
      "mobile_control": false,
      "multi_device": false
    }'::jsonb
  ),
  (
    'club',
    'Club',
    'Voor clubs die automatische sponsorrotatie, timing en rapportage willen.',
    'Prijs op aanvraag',
    2,
    40,
    '{
      "scoreboard": true,
      "manual_media": true,
      "automatic_sponsor_rotation": true,
      "sponsor_budget_tracking": true,
      "sponsor_interrupt_resume": true,
      "proof_of_play_export": true,
      "video_assets": true,
      "player_intros": true,
      "led_boarding": false,
      "cloud_control": false,
      "mobile_control": true,
      "multi_device": true
    }'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    'Voor grotere stadions met meerdere schermen, LED boarding en extra begeleiding.',
    'Prijs op aanvraag',
    5,
    50,
    '{
      "scoreboard": true,
      "manual_media": true,
      "automatic_sponsor_rotation": true,
      "sponsor_budget_tracking": true,
      "sponsor_interrupt_resume": true,
      "proof_of_play_export": true,
      "video_assets": true,
      "player_intros": true,
      "led_boarding": true,
      "cloud_control": true,
      "mobile_control": true,
      "multi_device": true
    }'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  price_label = excluded.price_label,
  features = excluded.features,
  max_activations_default = excluded.max_activations_default,
  active = true,
  sort_order = excluded.sort_order,
  updated_at = now();
