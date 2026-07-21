-- Per-user card ownership.
--
-- Mirrors the dice ownership model (see the player_profiles_and_dice migration):
-- the game makes a pool of cards available (the monster cards baked into the
-- saved decks), and each player owns some quantity of each. Ownership is keyed to
-- the Supabase auth user so a collection follows the Discord account across
-- devices rather than living in one browser.

-- Owned cards as a quantity per card id (the Yu-Gi-Oh! passcode, e.g. 10071456).
-- A player may own the same card many times, so ownership is a count rather than
-- a boolean.
create table if not exists public.player_cards (
	player_id uuid not null references public.profiles (id) on delete cascade,
	card_id bigint not null,
	quantity integer not null default 0 check (quantity >= 0),
	primary key (player_id, card_id)
);

-- Row-level security: a signed-in user may only ever see or touch their own
-- cards. Nothing is readable or writable across accounts.
alter table public.player_cards enable row level security;

create policy "Cards are viewable by their owner"
	on public.player_cards for select
	using (auth.uid() = player_id);

create policy "Cards are modifiable by their owner"
	on public.player_cards for all
	using (auth.uid() = player_id)
	with check (auth.uid() = player_id);

-- Grant cards to the calling user, incrementing quantities atomically. The input
-- may contain repeats (e.g. rolling ten random cards that collide); they are
-- aggregated per id before the upsert. Runs as the invoker, so RLS still applies
-- and a user can only ever grant cards to themselves.
create or replace function public.grant_cards(card_ids bigint[])
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
	-- alongside the on-signup trigger).
	insert into public.profiles (id) values (uid)
	on conflict (id) do nothing;

	insert into public.player_cards (player_id, card_id, quantity)
	select uid, counted.card_id, counted.n
	from (
		select card_id, count(*)::int as n
		from unnest(card_ids) as card_id
		group by card_id
	) as counted
	on conflict (player_id, card_id)
	do update set quantity = public.player_cards.quantity + excluded.quantity;
end;
$$;

grant execute on function public.grant_cards(bigint[]) to authenticated;
