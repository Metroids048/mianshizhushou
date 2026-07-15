-- Phase 5: account email, recovery, consent, outbox
alter table users add column email text;
alter table users add column email_verified_at text;
alter table users add column email_verification_token_hash text;
alter table users add column email_verification_expires_at text;
alter table users add column password_reset_token_hash text;
alter table users add column password_reset_expires_at text;
alter table users add column deleted_at text;
alter table users add column notification_prefs text not null default '{}';

create unique index if not exists idx_users_email on users(email);
create index if not exists idx_users_email_verify on users(email_verification_token_hash, email_verification_expires_at);
create index if not exists idx_users_password_reset on users(password_reset_token_hash, password_reset_expires_at);

create table if not exists consent_records (
  id text primary key,
  user_id text,
  consent_type text not null,
  consent_version text not null default 'v1',
  accepted_at text not null,
  detail text default '',
  foreign key(user_id) references users(id) on delete set null
);

create index if not exists idx_consent_records_user on consent_records(user_id, consent_type, accepted_at desc);

create table if not exists mail_outbox (
  id text primary key,
  user_id text,
  recipient text not null,
  subject text not null,
  template text not null,
  variables_json text not null default '{}',
  status text not null default 'queued',
  error_message text,
  created_at text not null,
  sent_at text,
  foreign key(user_id) references users(id) on delete set null
);

create index if not exists idx_mail_outbox_recipient on mail_outbox(recipient, created_at desc);
