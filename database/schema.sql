-- Run in the SQL editor of your duty-calendar Supabase project.
-- Safe to use in the original project too: only the new yolo_duties table changes.
create table if not exists public.yolo_duties (
  id uuid primary key,
  game_date date not null,
  item text not null check (char_length(item) between 1 and 60),
  player_id text not null check (char_length(player_id) between 1 and 150),
  player_name text not null check (char_length(player_name) between 1 and 100),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'assigned' check (status in ('assigned', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists yolo_duties_game_date_idx on public.yolo_duties(game_date);
create unique index if not exists yolo_duties_assignment_idx on public.yolo_duties(game_date, lower(item), player_id);
alter table public.yolo_duties enable row level security;
revoke all on public.yolo_duties from anon, authenticated;
grant select, insert, update, delete on public.yolo_duties to service_role;
-- Only the Vercel API accesses the table using its server-only secret.
