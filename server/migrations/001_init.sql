create table if not exists app_state (
  id text primary key,
  json text not null,
  updated_at text not null
);

create table if not exists cue_cards (
  id text primary key,
  json text not null,
  created_at text not null
);

create table if not exists interview_records (
  id text primary key,
  mode text not null,
  json text not null,
  created_at text not null
);

create table if not exists search_results (
  id text primary key,
  query text not null,
  provider text not null,
  json text not null,
  created_at text not null
);

create table if not exists prompt_runs (
  id text primary key,
  skill_id text not null default '',
  prompt_id text not null,
  model text not null,
  provider text not null default 'local-fallback',
  status text not null,
  latency_ms integer not null,
  retrieval_count integer not null default 0,
  search_used integer not null default 0,
  fallback_reason text not null default '',
  json text not null,
  created_at text not null
);

create table if not exists mock_sessions (
  id text primary key,
  position_id text not null,
  json text not null,
  updated_at text not null,
  created_at text not null
);

create table if not exists live_cue_sessions (
  id text primary key,
  position_id text not null,
  json text not null,
  updated_at text not null,
  created_at text not null
);

create table if not exists cue_card_cache (
  cache_key text primary key,
  json text not null,
  position_id text not null,
  created_at text not null
);

create table if not exists documents (
  id text primary key,
  position_id text,
  source_type text not null,
  source_id text not null,
  source_sub_type text,
  owner_key text not null default 'local-single-user',
  title text not null,
  summary text not null,
  content text not null,
  priority integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create unique index if not exists idx_documents_owner_source on documents(owner_key, source_type, source_id);
create index if not exists idx_documents_position on documents(position_id, source_type, updated_at desc);

create table if not exists document_chunks (
  id text primary key,
  document_id text not null,
  position_id text,
  source_type text not null,
  source_id text not null,
  source_sub_type text,
  owner_key text not null default 'local-single-user',
  title text not null,
  content text not null,
  chunk_index integer not null,
  priority integer not null default 0,
  created_at text not null,
  updated_at text not null,
  foreign key(document_id) references documents(id) on delete cascade
);

create index if not exists idx_document_chunks_lookup on document_chunks(position_id, source_type, source_id, chunk_index);
create virtual table if not exists document_chunks_fts using fts5(
  content,
  title,
  source_type unindexed,
  source_id unindexed,
  position_id unindexed,
  owner_key unindexed,
  chunk_id unindexed,
  content='',
  tokenize='unicode61'
);

create table if not exists retrieval_runs (
  id text primary key,
  query text not null,
  position_id text,
  owner_key text not null default 'local-single-user',
  chunk_ids_json text not null,
  latency_ms integer not null,
  created_at text not null
);

create index if not exists idx_retrieval_runs_position on retrieval_runs(position_id, created_at desc);
