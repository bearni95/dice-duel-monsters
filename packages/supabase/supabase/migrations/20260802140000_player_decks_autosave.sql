-- Decks persist while they are being built.
--
-- The original player_decks migration treated a deck as a document that is only
-- ever written whole: exactly 30 cards, always named, enforced both by the
-- `save_player_deck` RPC and by a deferred constraint trigger. That works for a
-- form with a save button, but the builder now writes on every edit — creating a
-- deck, renaming it, adding or removing a card each persist on their own — so a
-- deck spends most of its life legitimately incomplete.
--
-- The rules that stay, because they can never be true of a valid deck:
--   * at most 3 copies of any one card (unchanged, a per-row check),
--   * at most 30 cards in total,
--   * only cards the player owns, never more copies than they own (unchanged).
--
-- What relaxes is the *floor*: fewer than 30 cards, or no name, now just means
-- the deck isn't finished. Readiness to play is judged where it is acted on
-- (`playerDeckAdapter.validate`), not by refusing to store the work in progress.

-- The size rule, now a ceiling rather than an exact count.
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
	if tg_op = 'INSERT' then
		targets := array[new.deck_id];
	elsif tg_op = 'DELETE' then
		targets := array[old.deck_id];
	else
		-- An update can move a card between decks, growing one and shrinking the
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

			if total > 30 then
				raise exception 'a deck may hold at most 30 cards (deck % has %)', target, total;
			end if;
		end if;
	end loop;

	return null;
end;
$$;

-- A newly created deck starts empty, so there is nothing to check on insert into
-- `player_decks` any more; the ceiling is only ever crossed by the cards table.
drop trigger if exists player_decks_size_check on public.player_decks;

-- Recreated so it runs the rewritten function under a name that reflects what it
-- now enforces. Still deferred: `save_player_deck` clears a deck's contents and
-- re-inserts them in one transaction, and only the end state is judged.
drop trigger if exists player_deck_cards_size_check on public.player_deck_cards;

create constraint trigger player_deck_cards_size_check
	after insert or update or delete on public.player_deck_cards
	deferrable initially deferred
	for each row execute function public.check_deck_size();

-- Create or replace a deck in one atomic call.
--
-- `p_entries` is a JSON array of `{ "card_id": <bigint>, "quantity": <1..3> }`,
-- and may be empty — that is how the builder creates a deck before any card has
-- been picked. Passing a null `p_deck_id` creates a new deck; passing an
-- existing one replaces its name and contents wholesale. Runs as the invoker, so
-- RLS still applies and a user can only ever write their own decks. Returns the
-- deck id.
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

	-- Fail fast with a readable message rather than letting the deferred size
	-- trigger blow up at commit time.
	select coalesce(sum(e.quantity), 0) into total
	from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(card_id bigint, quantity integer);

	if total > 30 then
		raise exception 'a deck may hold at most 30 cards (got %)', total;
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(card_id bigint, quantity integer)
		where e.quantity < 1 or e.quantity > 3
	) then
		raise exception 'a deck may hold at most 3 copies of the same card';
	end if;

	-- The ownership FK already rejects cards the player doesn't have at all; this
	-- additionally caps each entry at the number of copies they own.
	if exists (
		select 1
		from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(card_id bigint, quantity integer)
		left join public.player_cards pc
			on pc.player_id = uid and pc.card_id = e.card_id
		where coalesce(pc.quantity, 0) < e.quantity
	) then
		raise exception 'a deck cannot hold more copies of a card than you own';
	end if;

	if target is null then
		insert into public.player_decks (player_id, name)
		values (uid, btrim(coalesce(p_name, '')))
		returning id into target;
	else
		update public.player_decks
		set name = btrim(coalesce(p_name, '')), updated_at = now()
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
	from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(card_id bigint, quantity integer);

	return target;
end;
$$;

grant execute on function public.save_player_deck(uuid, text, jsonb) to authenticated;
