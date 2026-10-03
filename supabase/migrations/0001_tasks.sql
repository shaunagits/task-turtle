-- Task Turtle: one table, private per person.
create table if not exists public.tasks (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text        text not null check (char_length(text) between 1 and 240),
  tags        text[] not null default '{}',
  due_at      timestamptz,
  all_day     boolean not null default false,
  priority    boolean not null default false,
  done        boolean not null default false,
  done_at     timestamptz,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on public.tasks (user_id);

alter table public.tasks enable row level security;

-- Each person can only ever see and change their own tasks.
create policy "Read own tasks"   on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "Add own tasks"    on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Edit own tasks"   on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Remove own tasks" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

-- Live updates across devices.
alter publication supabase_realtime add table public.tasks;
