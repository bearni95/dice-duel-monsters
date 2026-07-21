-- Player profiles and dice ownership.
--
-- Ownership used to live in the browser's localStorage, so a collection was
-- per-device and vanished when site data was cleared. This moves it into the
-- database, keyed to the Supabase auth user, so a player's name, avatar, and
-- dice follow their Discord account across devices.

-- A player's profile: exactly one row per auth user. `avatar` is a character
-- slug (see the frontend `characters` data), not a URL.
create table if not exists public.profiles (
	id uuid primary key references auth.users (id) on delete cascade,
	name text not null default '',
	avatar text,
	updated_at timestamptz not null default now()
);

-- Owned dice as a quantity per spawned-die id (e.g. `move-r3`). A player may own
-- the same die many times, so ownership is a count rather than a boolean.
create table if not exists public.player_dice (
	player_id uuid not null references public.profiles (id) on delete cascade,
	die_id text not null,
	quantity integer not null default 0 check (quantity >= 0),
	primary key (player_id, die_id)
);

-- Row-level security: a signed-in user may only ever see or touch their own
-- profile and their own dice. Nothing is readable or writable across accounts.
alter table public.profiles enable row level security;
alter table public.player_dice enable row level security;

create policy "Profiles are viewable by their owner"
	on public.profiles for select
	using (auth.uid() = id);

create policy "Profiles are insertable by their owner"
	on public.profiles for insert
	with check (auth.uid() = id);

create policy "Profiles are updatable by their owner"
	on public.profiles for update
	using (auth.uid() = id)
	with check (auth.uid() = id);

create policy "Dice are viewable by their owner"
	on public.player_dice for select
	using (auth.uid() = player_id);

create policy "Dice are modifiable by their owner"
	on public.player_dice for all
	using (auth.uid() = player_id)
	with check (auth.uid() = player_id);

-- Grant dice to the calling user, incrementing quantities atomically. The input
-- may contain repeats (e.g. rolling three random dice that collide); they are
-- aggregated per id before the upsert. Runs as the invoker, so RLS still applies
-- and a user can only ever grant dice to themselves.
create or replace function public.grant_dice(die_ids text[])
	returns void
	language plpgsql
	security invoker
	set search_path = public
as $$
declare
	uid uuid := auth.uid();
begin
	if uid is null then
		raise exception 'not authenticated';
	end if;

	-- Ensure the profile row exists before referencing it (belt-and-suspenders
	-- alongside the on-signup trigger below).
	insert into public.profiles (id) values (uid)
	on conflict (id) do nothing;

	insert into public.player_dice (player_id, die_id, quantity)
	select uid, counted.die_id, counted.n
	from (
		select die_id, count(*)::int as n
		from unnest(die_ids) as die_id
		group by die_id
	) as counted
	on conflict (player_id, die_id)
	do update set quantity = public.player_dice.quantity + excluded.quantity;
end;
$$;

grant execute on function public.grant_dice(text[]) to authenticated;

-- Seed a profile row the moment a user signs up, pulling a starting display name
-- from the Discord OAuth metadata. `avatar` stays null until the player picks a
-- character slug in the app (the Discord avatar URL is a different concept).
create or replace function public.handle_new_user()
	returns trigger
	language plpgsql
	security definer
	set search_path = public
as $$
begin
	insert into public.profiles (id, name)
	values (
		new.id,
		coalesce(
			new.raw_user_meta_data ->> 'full_name',
			new.raw_user_meta_data ->> 'name',
			''
		)
	)
	on conflict (id) do nothing;
	return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.handle_new_user();
