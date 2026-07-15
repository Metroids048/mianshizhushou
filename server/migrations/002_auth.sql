-- Phase 1.1: Authentication tables
create table if not exists users (
  id text primary key,
  phone text unique,
  display_name text not null default '',
  password_hash text,
  created_at text not null,
  updated_at text not null
);

create table if not exists auth_identities (
  id text primary key,
  user_id text not null,
  provider text not null,  -- 'phone', 'password', 'wechat'
  identifier text not null, -- phone number or external id
  created_at text not null,
  foreign key(user_id) references users(id) on delete cascade
);

create unique index if not exists idx_auth_identity on auth_identities(provider, identifier);

create table if not exists user_sessions (
  id text primary key,
  user_id text not null,
  token_jti text not null unique,
  expires_at text not null,
  created_at text not null,
  foreign key(user_id) references users(id) on delete cascade
);

create index if not exists idx_user_sessions_user on user_sessions(user_id, created_at desc);
