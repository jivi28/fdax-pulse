-- Harden the update trigger function against object shadowing in mutable paths.
alter function public.set_updated_at() set search_path = '';

-- Cover owner-filtered access and remaining foreign-key joins.
create index if not exists replay_sessions_strategy_config_idx
  on public.replay_sessions (strategy_config_id);
create index if not exists minute_bars_user_id_idx
  on public.minute_bars (user_id);
create index if not exists signals_user_id_idx
  on public.signals (user_id);
create index if not exists paper_orders_session_id_idx
  on public.paper_orders (session_id);
create index if not exists paper_orders_signal_id_idx
  on public.paper_orders (signal_id);
create index if not exists paper_orders_user_id_idx
  on public.paper_orders (user_id);
create index if not exists paper_fills_user_id_idx
  on public.paper_fills (user_id);
create index if not exists positions_user_id_idx
  on public.positions (user_id);
create index if not exists equity_snapshots_user_id_idx
  on public.equity_snapshots (user_id);
create index if not exists worker_heartbeats_user_id_idx
  on public.worker_heartbeats (user_id);
create index if not exists audit_events_user_id_idx
  on public.audit_events (user_id);
