-- Phase 2: Quota tracking
create table if not exists quota_ledger (
  id text primary key,
  user_id text not null,
  endpoint text not null,
  created_at text not null
);

create index if not exists idx_quota_ledger_user on quota_ledger(user_id, created_at);
