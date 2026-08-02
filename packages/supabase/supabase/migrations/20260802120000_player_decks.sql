-- Player-built decks.
--
-- Builds on the card ownership model (see the player_cards migration): a player
-- assembles the cards they own into named 30-card decks. Copies are *not*
-- consumed by a deck — the same owned card may appear in as many decks as the
-- player likes — so a deck is a reference to the collection, not a withdrawal
-- from it.
--
-- The rules enforced here, so they hold no matter which client writes:
--   * a deck contains exactly 30 cards (counting copies),
--   * at most 3 copies of any one card in the same deck,
--   * a deck may only reference cards the player actually owns (FK), and never
--     more copies of a card than they own.

-- A named deck belonging to one player.
create table if not exists public.player_decks (
	id uuid primary key default gen_random_uuid(),
	player_id uuid not null references public.profiles (id) on delete cascade,
	name text not null default '',
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	-- Lets the deck-cards table carry `player_id` and point at (id, player_id),
	-- which is what makes the ownership FK below expressible.
	unique (id, player_id)
);

create index if not exists player_decks_player_id_idx on public.player_decks (player_id);

-- The contents of a deck, as a copy count per card id (the Yu-Gi-Oh! passcode).
--
-- `player_id` is denormalised onto this table on purpose: it is what lets the
-- two foreign keys below tie a deck entry to both its deck *and* the owner's
-- collection row, so the database itself guarantees a deck can never contain a
-- card its owner doesn't have. The composite FK back to (id, player_id) keeps
-- the denormalised column honest — it can never disagree with the deck's owner.
create table if not exists public.player_deck_cards (
	deck_id uuid not null,
	player_id uuid not null,
	card_id bigint not null,
	quantity integer not null check (quantity between 1 and 3),
	primary key (deck_id, card_id),
	constraint player_deck_cards_deck_fkey
		foreign key (deck_id, player_id)
		references public.player_decks (id, player_id) on delete cascade,
	-- Ownership: the card must exist in the player's collection. Cascading means
	-- losing a card also strips it from the decks that used it. Nothing in the app
	-- deletes ownership rows today (grants only ever increment), so in practice
	-- this only ever fires as a guard against a deck referencing a card the player
	-- never owned.
	constraint player_deck_cards_owned_fkey
		foreign key (player_id, card_id)
		references public.player_cards (player_id, card_id) on delete cascade
);

create index if not exists player_deck_cards_owned_idx
	on public.player_deck_cards (player_id, card_id);

-- Row-level security: a signed-in user may only ever see or touch their own
-- decks and their contents. Nothing is readable or writable across accounts.
alter table public.player_decks enable row level security;
alter table public.player_deck_cards enable row level security;

create policy "Decks are viewable by their owner"
	on public.player_decks for select
	using (auth.uid() = player_id);

create policy "Decks are modifiable by their owner"
	on public.player_decks for all
	using (auth.uid() = player_id)
	with check (auth.uid() = player_id);

create policy "Deck cards are viewable by their owner"
	on public.player_deck_cards for select
	using (auth.uid() = player_id);

create policy "Deck cards are modifiable by their owner"
	on public.player_deck_cards for all
	using (auth.uid() = player_id)
	with check (auth.uid() = player_id);

-- The 30-card rule. It spans rows, so it can't be a check constraint; it is a
-- *deferred* constraint trigger instead, evaluated once at commit. That is what
-- lets `save_player_deck` below insert a deck and then its 30 cards inside one
-- transaction without the deck being briefly (and fatally) empty.
create or replace function public.check_deck_size()
	returns trigger
	language plpgsql
	set search_path = public
as $$
declare
	-- The deck(s) this row change could have resized. `new` and `old` are only
	-- readable for the operations that define them — touching `new` on a DELETE
	-- raises "record new is not assigned yet" — so each case picks its own.
	targets uuid[];
	target uuid;
	total integer;
begin
	if tg_table_name = 'player_decks' then
		targets := array[new.id];
	elsif tg_op = 'INSERT' then
		targets := array[new.deck_id];
	elsif tg_op = 'DELETE' then
		targets := array[old.deck_id];
	else
		-- An update can move a card between decks, shrinking one and growing the
		-- other, so both ends are checked.
		targets := array[old.deck_id, new.deck_id];
	end if;

	foreach target in array targets loop
		-- The deck itself was dropped in this transaction (or by its cascade); there
		-- is no longer a deck to be the wrong size.
		if exists (select 1 from public.player_decks where id = target) then
			select coalesce(sum(quantity), 0) into total
			from public.player_deck_cards
			where deck_id = target;

			if total <> 30 then
				raise exception 'a deck must contain exactly 30 cards (deck % has %)', target, total;
			end if;
		end if;
	end loop;

	return null;
end;
$$;

drop trigger if exists player_decks_size_check on public.player_decks;
drop trigger if exists player_deck_cards_size_check on public.player_deck_cards;

-- Insert-only on the deck itself: a newly created deck must end the transaction
-- holding 30 cards. Renaming a deck later doesn't re-check anything.
create constraint trigger player_decks_size_check
	after insert on public.player_decks
	deferrable initially deferred
	for each row execute function public.check_deck_size();

create constraint trigger player_deck_cards_size_check
	after insert or update or delete on public.player_deck_cards
	deferrable initially deferred
	for each row execute function public.check_deck_size();

-- Create or replace a deck in one atomic call.
--
-- `p_entries` is a JSON array of `{ "card_id": <bigint>, "quantity": <1..3> }`.
-- Passing a null `p_deck_id` creates a new deck; passing an existing one
-- replaces its name and contents wholesale. Runs as the invoker, so RLS still
-- applies and a user can only ever write their own decks. Returns the deck id.
create or replace function public.save_player_deck(
	p_deck_id uuid,
	p_name text,
	p_entries jsonb
)
	returns uuid
	language plpgsql
	security invoker
	set search_path = public
as $$
declare
	uid uuid := auth.uid();
	target uuid := p_deck_id;
	total integer;
begin
	if uid is null then
		raise exception 'not authenticated';
	end if;

	if coalesce(btrim(p_name), '') = '' then
		raise exception 'a deck needs a name';
	end if;

	-- Fail fast with a readable message rather than letting the deferred size
	-- trigger blow up at commit time.
	select coalesce(sum(e.quantity), 0) into total
	from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(card_id bigint, quantity integer);

	if total <> 30 then
		raise exception 'a deck must contain exactly 30 cards (got %)', total;
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_entries) as e(card_id bigint, quantity integer)
		where e.quantity < 1 or e.quantity > 3
	) then
		raise exception 'a deck may hold at most 3 copies of the same card';
	end if;

	-- The ownership FK already rejects cards the player doesn't have at all; this
	-- additionally caps each entry at the number of copies they own.
	if exists (
		select 1
		from jsonb_to_recordset(p_entries) as e(card_id bigint, quantity integer)
		left join public.player_cards pc
			on pc.player_id = uid and pc.card_id = e.card_id
		where coalesce(pc.quantity, 0) < e.quantity
	) then
		raise exception 'a deck cannot hold more copies of a card than you own';
	end if;

	if target is null then
		insert into public.player_decks (player_id, name)
		values (uid, btrim(p_name))
		returning id into target;
	else
		update public.player_decks
		set name = btrim(p_name), updated_at = now()
		where id = target and player_id = uid;

		if not found then
			raise exception 'deck not found';
		end if;
	end if;

	-- Contents are replaced wholesale; the deferred size trigger only judges the
	-- end state, so the intermediate empty deck is fine.
	delete from public.player_deck_cards where deck_id = target;

	insert into public.player_deck_cards (deck_id, player_id, card_id, quantity)
	select target, uid, e.card_id, e.quantity
	from jsonb_to_recordset(p_entries) as e(card_id bigint, quantity integer);

	return target;
end;
$$;

grant execute on function public.save_player_deck(uuid, text, jsonb) to authenticated;
