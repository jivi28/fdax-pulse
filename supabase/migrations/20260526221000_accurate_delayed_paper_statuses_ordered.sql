-- Accurate delayed-paper qualification and non-executable audit states.
-- This migration follows delayed-paper metadata because it extends those enums.
alter type public.data_source add value if not exists 'delayed_deutsche_boerse';
alter type public.signal_status add value if not exists 'blocked';
alter type public.data_sufficiency add value if not exists 'terms_required';
alter type public.data_sufficiency add value if not exists 'checking';
alter type public.data_sufficiency add value if not exists 'fetch_error';
alter type public.data_sufficiency add value if not exists 'paused_quality_error';
alter type public.data_sufficiency add value if not exists 'unavailable';

alter table public.replay_sessions
  add column if not exists source_health jsonb not null default '{}'::jsonb;

alter table public.paper_orders drop constraint if exists paper_orders_status_check;
alter table public.paper_orders
  add constraint paper_orders_status_check
  check (status in ('generated', 'approved', 'skipped', 'filled', 'blocked'));

-- RLS remains enabled by the base migration; expose only owner-authorized compact
-- tables to authenticated Data API clients when SQL-created tables require grants.
grant select, insert, update, delete on public.replay_sessions to authenticated;
grant select, insert, update, delete on public.minute_bars to authenticated;
grant select, insert, update, delete on public.signals to authenticated;
grant select, insert, update, delete on public.paper_orders to authenticated;
