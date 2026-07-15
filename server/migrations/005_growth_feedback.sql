-- Phase 4: Feedback
create table if not exists feedback_tickets (
  id text primary key,
  user_id text,
  category text not null, -- 'bug', 'feature', 'ai_quality', 'other'
  content text not null,
  contact text,
  created_at text not null
);

-- Phase 4: Consent records (already created in 002_auth.sql, ensure here)
-- create table if not exists consent_records ...

-- Phase 4: Audit events
create table if not exists audit_events (
  id text primary key,
  user_id text,
  action text not null, -- 'login', 'export', 'delete_request', 'feedback'
  detail text default '',
  created_at text not null
);

create index if not exists idx_audit_events_user on audit_events(user_id, created_at);
