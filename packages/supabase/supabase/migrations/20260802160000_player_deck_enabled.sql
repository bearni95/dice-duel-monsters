-- Which deck a player actually plays with.
--
-- Decks are built on /decks, but the board needs to know which of them to deal
-- from. That is this flag: a deck is either enabled (offered to the board) or
-- disabled (kept, but not played). It is stored per deck rather than as a single
-- pointer on the profile so the choice survives a deck being deleted, and so a
-- deck carries its own state instead of the profile carrying a reference that
-- can dangle.
--
-- New decks start disabled. The client treats a player's *only* deck as enabled
-- regardless of the flag (see playerDeckAdapter.activeDeck), so the flag only
-- ever has to be touched once a second deck exists — which is also why the
-- default is `false` rather than `true`: it means "not chosen yet", and choosing
-- is only meaningful when there is something to choose between.
--
-- Nothing enforces a single enabled deck. Several may be flagged at once; the
-- board plays the first of them in creation order, and /decks says which one
-- that is.
alter table public.player_decks
	add column if not exists enabled boolean not null default false;

-- The board reads this straight after sign-in, filtered to the owner's rows by
-- RLS; the partial index keeps that lookup off a full scan of the player's decks
-- as their collection of decks grows.
create index if not exists player_decks_enabled_idx
	on public.player_decks (player_id)
	where enabled;
