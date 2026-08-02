-- Drop dice ownership.
--
-- Dice are no longer something a player owns: every side plays with the full set
-- of dice the game can produce (the board engine spawns them from the templates),
-- so there is nothing per-user left to store. This removes the `player_dice`
-- table and its `grant_dice` RPC introduced in the player_profiles_and_dice
-- migration. Profiles and card ownership are untouched.

drop function if exists public.grant_dice(text[]);

-- Drops the table along with its RLS policies.
drop table if exists public.player_dice;
