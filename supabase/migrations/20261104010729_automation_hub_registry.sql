-- Recovered from production schema_migrations (applied there outside this repo).
create table public.automation_hub_tasks (
 id text primary key, owner_id uuid not null references auth.users(id), title text not null,
 kind text not null check(kind in ('gmail','sheets','summary')), enabled boolean not null,
 schedule text not null, prompt text not null, last_run_at timestamptz, synced_at timestamptz not null default now()
);
create table public.automation_hub_commands (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 task_id text not null references public.automation_hub_tasks(id), action text not null check(action in ('set_enabled','update_prompt','update_schedule')),
 payload jsonb not null, state text not null default 'pending' check(state in ('pending','processing','done','error')),
 note text, created_at timestamptz not null default now(), completed_at timestamptz,
 check (jsonb_typeof(payload)='object'),
 check ((action='set_enabled' and jsonb_typeof(payload->'enabled')='boolean')
 or (action='update_prompt' and jsonb_typeof(payload->'prompt')='string' and length(payload->>'prompt') between 10 and 16000)
 or (action='update_schedule' and jsonb_typeof(payload->'hours')='number' and (payload->>'hours')::numeric in (1,2,4,6,12,24))
 or (action='update_schedule' and jsonb_typeof(payload->'time')='string' and (payload->>'time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
);
create index automation_hub_commands_pending_idx on public.automation_hub_commands(state,created_at);
create table public.automation_hub_events (
 id text primary key, owner_id uuid not null references auth.users(id), task_id text references public.automation_hub_tasks(id),
 event_type text not null, title text not null, detail text not null, source_url text, happened_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.automation_hub_meta (
 owner_id uuid primary key references auth.users(id), synced_at timestamptz, sheet_revision text, sync_note text
);
alter table public.automation_hub_tasks enable row level security;
alter table public.automation_hub_commands enable row level security;
alter table public.automation_hub_events enable row level security;
alter table public.automation_hub_meta enable row level security;
revoke all on public.automation_hub_tasks,public.automation_hub_commands,public.automation_hub_events,public.automation_hub_meta from anon,authenticated;
grant select on public.automation_hub_tasks,public.automation_hub_commands,public.automation_hub_events,public.automation_hub_meta to authenticated;
grant insert (id,owner_id,task_id,action,payload) on public.automation_hub_commands to authenticated;
create policy hub_tasks_read on public.automation_hub_tasks for select to authenticated using ((select auth.uid())=owner_id);
create policy hub_commands_read on public.automation_hub_commands for select to authenticated using ((select auth.uid())=owner_id);
create policy hub_commands_create on public.automation_hub_commands for insert to authenticated with check (
 (select auth.uid())=owner_id and exists(select 1 from public.automation_hub_tasks t where t.id=task_id and t.owner_id=(select auth.uid()))
);
create policy hub_events_read on public.automation_hub_events for select to authenticated using ((select auth.uid())=owner_id);
create policy hub_meta_read on public.automation_hub_meta for select to authenticated using ((select auth.uid())=owner_id);
