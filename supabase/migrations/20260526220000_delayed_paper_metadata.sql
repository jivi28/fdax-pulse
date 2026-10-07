create type public.session_source_mode as enum ('delayed_paper', 'csv_replay', 'fixture_demo');
create type public.fill_model as enum ('demo_reference', 'realistic_paper');
create type public.data_sufficiency as enum ('not_evaluated', 'verified_taq', 'insufficient_taq');

alter type public.data_source add value if not exists 'delayed_deutsche_boerse_unverified';

alter table public.strategy_configs
  add column fill_model public.fill_model not null default 'realistic_paper',
  add column slippage_ticks integer not null default 0 check (slippage_ticks >= 0),
  add column contract_snapshot jsonb not null default '{}'::jsonb;

alter table public.replay_sessions
  add column session_source_mode public.session_source_mode not null default 'csv_replay',
  add column source_name text,
  add column delay_minutes integer check (delay_minutes is null or delay_minutes >= 0),
  add column data_sufficiency public.data_sufficiency not null default 'not_evaluated',
  add column latest_exchange_timestamp timestamptz,
  add column latest_received_timestamp timestamptz,
  add column fill_model public.fill_model not null default 'realistic_paper',
  add column commission_per_side_eur numeric(12, 2) not null default 0.00 check (commission_per_side_eur >= 0),
  add column slippage_ticks integer not null default 0 check (slippage_ticks >= 0),
  add column orderflow_threshold integer not null default 24,
  add column volume_threshold integer not null default 242,
  add column contract_snapshot jsonb not null default '{}'::jsonb,
  add column quality_summary jsonb not null default '{}'::jsonb;

alter table public.minute_bars
  add column buy_volume integer not null default 0 check (buy_volume >= 0),
  add column sell_volume integer not null default 0 check (sell_volume >= 0),
  add column orderflow_threshold_pass boolean not null default false,
  add column volume_threshold_pass boolean not null default false,
  add column evaluation_action text not null default 'no_action'
    check (evaluation_action in ('no_action', 'buy', 'hold', 'sell', 'risk_halt', 'blocked'));

grant select, insert, update, delete on public.strategy_configs to authenticated;
grant select, insert, update, delete on public.replay_sessions to authenticated;
grant select, insert, update, delete on public.minute_bars to authenticated;
grant select, insert, update, delete on public.signals to authenticated;
grant select, insert, update, delete on public.paper_orders to authenticated;
grant select, insert, update, delete on public.paper_fills to authenticated;
grant select, insert, update, delete on public.positions to authenticated;
grant select, insert, update, delete on public.equity_snapshots to authenticated;
grant select, insert, update, delete on public.worker_commands to authenticated;
grant select on public.worker_heartbeats to authenticated;
grant select, insert, update, delete on public.audit_events to authenticated;
