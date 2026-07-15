-- Windows local audio-bridge: persistent device credentials for auto-reconnect after first pairing.
create table if not exists audio_bridge_devices (
  id text primary key,
  user_id text not null,
  device_name text not null default '',
  token_hash text not null,
  created_at text not null,
  last_seen_at text not null,
  revoked_at text,
  foreign key(user_id) references users(id) on delete cascade
);

create unique index if not exists idx_audio_bridge_devices_token on audio_bridge_devices(token_hash);
create index if not exists idx_audio_bridge_devices_user on audio_bridge_devices(user_id, revoked_at);
