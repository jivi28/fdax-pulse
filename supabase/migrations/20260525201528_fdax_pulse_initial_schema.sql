create type public.replay_mode as enum ('automatic', 'recommendation');
create type public.session_status as enum (
  'created',
  'running',
  'paused_for_action',
  'stopped',
  'completed',
  'failed'
);
create type public.data_source as enum (
  'csv_iqfeed',
  'csv_databento',
  'fixture',
  'live_databento_disabled'
);
create type public.signal_action as enum ('buy', 'hold', 'sell', 'no_action', 'risk_halt');
create type public.signal_status as enum ('generated', 'executed', 'skipped');
create type public.command_kind as enum (
  'start',
  'pause',
  'resume',
  'set_speed',
  'approve_entry',
  'approve_exit',
  'skip_signal',
  'stop'
);
create type public.command_status as enum ('pending', 'claimed', 'completed', 'failed');

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.strategy_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Pecchiari FDAX strategy',
  mode public.replay_mode not null default 'automatic',
  orderflow_threshold integer not null default 24 check (orderflow_threshold >= 0),
  volume_threshold integer not null default 242 check (volume_threshold >= 0),
  daily_loss_limit_eur numeric(12, 2) not null default 250.00 check (daily_loss_limit_eur > 0),
  commission_per_side_eur numeric(12, 2) not null default 0.00 check (commission_per_side_eur >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.replay_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_config_id uuid references public.strategy_configs(id) on delete set null,
  mode public.replay_mode not null,
  data_source public.data_source not null,
  status public.session_status not null default 'created',
  source_filename text,
  worker_id text,
  started_at timestamptz,
  ended_at timestamptz,
  realized_pnl_eur numeric(12, 2) not null default 0.00,
  gross_pnl_eur numeric(12, 2) not null default 0.00,
  win_ratio numeric(8, 2),
  risk_reward numeric(12, 4),
  quality_issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.minute_bars (
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  orderflow integer not null,
  volume integer not null check (volume >= 0),
  close_price numeric(16, 4) not null,
  last_bid numeric(16, 4) not null,
  last_ask numeric(16, 4) not null,
  classified_volume integer not null check (classified_volume >= 0),
  unclassified_volume integer not null check (unclassified_volume >= 0),
  trade_count integer not null check (trade_count >= 0),
  primary key (session_id, sequence),
  check (last_bid <= last_ask)
);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  timestamp timestamptz not null,
  action public.signal_action not null,
  reason text not null,
  orderflow integer not null,
  volume integer not null check (volume >= 0),
  status public.signal_status not null default 'generated',
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table public.paper_orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  side text not null check (side in ('buy', 'sell')),
  order_type text not null default 'paper_market' check (order_type = 'paper_market'),
  quantity integer not null default 1 check (quantity = 1),
  status text not null check (status in ('generated', 'approved', 'skipped', 'filled')),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.paper_fills (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  timestamp timestamptz not null,
  side text not null check (side in ('buy', 'sell')),
  price numeric(16, 4) not null,
  gross_reference_price numeric(16, 4) not null,
  quantity integer not null default 1 check (quantity = 1),
  reason text not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  side text not null default 'long' check (side = 'long'),
  quantity integer not null default 1 check (quantity = 1),
  status text not null check (status in ('open', 'closed')),
  entry_price numeric(16, 4) not null,
  exit_price numeric(16, 4),
  realized_pnl_eur numeric(12, 2),
  unrealized_pnl_eur numeric(12, 2) not null default 0.00,
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'open' and exit_price is null) or status = 'closed')
);

create unique index one_open_position_per_session
  on public.positions (session_id)
  where status = 'open';

create table public.equity_snapshots (
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  timestamp timestamptz not null,
  realized_pnl_eur numeric(12, 2) not null,
  unrealized_pnl_eur numeric(12, 2) not null,
  equity_pnl_eur numeric(12, 2) not null,
  primary key (session_id, sequence)
);

create table public.worker_commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.command_kind not null,
  payload jsonb not null default '{}'::jsonb,
  status public.command_status not null default 'pending',
  idempotency_key text not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.worker_heartbeats (
  id bigint generated always as identity primary key,
  session_id uuid references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_id text not null,
  status text not null,
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, worker_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.replay_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create index replay_sessions_user_created_idx on public.replay_sessions (user_id, created_at desc);
create index minute_bars_session_time_idx on public.minute_bars (session_id, starts_at);
create index signals_session_time_idx on public.signals (session_id, timestamp);
create index worker_commands_pending_idx on public.worker_commands (session_id, created_at)
  where status = 'pending';
create index worker_heartbeats_session_latest_idx on public.worker_heartbeats (session_id, last_seen_at desc);

create trigger strategy_configs_updated_at
before update on public.strategy_configs
for each row execute function public.set_updated_at();

create trigger replay_sessions_updated_at
before update on public.replay_sessions
for each row execute function public.set_updated_at();

alter table public.strategy_configs enable row level security;
alter table public.replay_sessions enable row level security;
alter table public.minute_bars enable row level security;
alter table public.signals enable row level security;
alter table public.paper_orders enable row level security;
alter table public.paper_fills enable row level security;
alter table public.positions enable row level security;
alter table public.equity_snapshots enable row level security;
alter table public.worker_commands enable row level security;
alter table public.worker_heartbeats enable row level security;
alter table public.audit_events enable row level security;

create policy "owner access strategy configs" on public.strategy_configs
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access replay sessions" on public.replay_sessions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access minute bars" on public.minute_bars
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access signals" on public.signals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access paper orders" on public.paper_orders
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access paper fills" on public.paper_fills
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access positions" on public.positions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access equity snapshots" on public.equity_snapshots
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner access worker commands" on public.worker_commands
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "owner read worker heartbeats" on public.worker_heartbeats
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner access audit events" on public.audit_events
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.replay_sessions;
alter publication supabase_realtime add table public.minute_bars;
alter publication supabase_realtime add table public.signals;
alter publication supabase_realtime add table public.paper_fills;
alter publication supabase_realtime add table public.positions;
alter publication supabase_realtime add table public.worker_commands;
alter publication supabase_realtime add table public.worker_heartbeats;
