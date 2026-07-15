-- Phase 1.2: Add user_id to existing tables for multi-user isolation
alter table app_state add column user_id text;
create index if not exists idx_app_state_user on app_state(user_id);

alter table interview_records add column user_id text;
create index if not exists idx_interview_records_user on interview_records(user_id);

alter table prompt_runs add column user_id text;
create index if not exists idx_prompt_runs_user on prompt_runs(user_id);

alter table mock_sessions add column user_id text;
create index if not exists idx_mock_sessions_user on mock_sessions(user_id);

alter table live_cue_sessions add column user_id text;
create index if not exists idx_live_cue_sessions_user on live_cue_sessions(user_id);

alter table documents add column user_id text;
create index if not exists idx_documents_user on documents(user_id);

alter table document_chunks add column user_id text;
create index if not exists idx_document_chunks_user on document_chunks(user_id);

alter table retrieval_runs add column user_id text;
