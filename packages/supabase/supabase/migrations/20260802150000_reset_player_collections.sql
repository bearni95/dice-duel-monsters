-- Reset every player's collection.
--
-- Collections accumulated cards under a pool rule that has since tightened. The
-- drawable pool was only restricted to playable monsters on 2026-07-21 (see the
-- `Restrict the drawable card pool to playable monsters that have baked art`
-- commit), and nothing ever revisited what had already been granted — so cards
-- the game can no longer render (no committed PNG under cards/generated) were
-- still sitting in `player_cards`, showing up as "card not found" tiles in the
-- collection grid and the deck builder.
--
-- Rather than trying to work out which rows are still legitimate, every
-- collection is cleared and players re-draw against the allow-list introduced in
-- the migration that follows this one. Deleting the ownership rows also lets the
-- `available_cards` foreign key be added without a pre-existing violation.

-- Decks go first and explicitly. `player_deck_cards` would be cleared anyway by
-- the ownership cascade, but that would leave every deck alive as a named,
-- empty shell — a 0/30 deck the player never emptied. Dropping the decks
-- themselves means collections and decks are reset together.
delete from public.player_decks;

delete from public.player_cards;
