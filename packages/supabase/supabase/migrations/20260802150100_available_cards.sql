-- The allow-list of cards a player may ever be granted.
--
-- Until now nothing outside the client decided what a player could own:
-- `grant_cards` took any bigint array and incremented it into `player_cards`.
-- That made the pool rule a client-side convention, and a convention is exactly
-- what drifted — collections ended up holding cards with no committed PNG, which
-- the shipped SPA can only render as a "card not found" placeholder.
--
-- The rule this table encodes: a card is grantable when it appears in a saved
-- deck, is a playable monster with a billboard cutout, and — the part that was
-- only ever assumed — has a baked full-size PNG committed under the assets
-- package. The list is generated straight from those files by the data package's
-- build-grantable-cards, so it cannot claim art that isn't on disk. Regenerate
-- and push it with `pnpm --filter data gen:grantable` whenever cards are baked.

create table if not exists public.available_cards (
	card_id bigint primary key
);

-- Readable by everyone (the client uses its generated JSON copy, but nothing
-- here is secret), writable by no one: there are no insert/update/delete
-- policies, so the list can only ever change through a migration. That is what
-- makes it an authority rather than another copy of the client's opinion.
alter table public.available_cards enable row level security;

drop policy if exists "Available cards are readable by everyone" on public.available_cards;
create policy "Available cards are readable by everyone"
	on public.available_cards for select
	using (true);

insert into public.available_cards (card_id)
values
	(423705), (1184620), (1546123), (1784619), (2111707), (2851070), (2906250), (3134241), (3366982), (3573512),
	(3643300), (4266839), (4796100), (5053103), (5126490), (5388481), (5405694), (5818798), (6285791), (6368038),
	(7084129), (7093411), (7489323), (7572887), (8471389), (8649148), (10000000), (10000020), (10071456), (10202894),
	(10485110), (10526791), (11091375), (11549357), (11901678), (12206212), (12493482), (13039848), (13069066), (13215230),
	(13314457), (13429800), (13723605), (14141448), (14851496), (14898066), (14977074), (15025844), (15150365), (15303296),
	(15367030), (15401633), (15480588), (16304628), (16507828), (16972957), (17444133), (17658803), (17732278), (17955766),
	(17985575), (18036057), (18246479), (19737320), (20394040), (20721928), (21015833), (21698716), (21844576), (23289281),
	(23771716), (23995346), (24128274), (24530661), (24611934), (25119460), (25366484), (25652259), (25655502), (25833572),
	(25955164), (26202165), (26376390), (26378150), (27125110), (27324313), (27927359), (28279543), (28677304), (29436665),
	(29654737), (30113682), (30208479), (30451366), (30464153), (30532390), (30778711), (30860696), (31122090), (31339260),
	(31553716), (31786629), (31987274), (32452818), (32933942), (34100324), (34460851), (35565537), (35809262), (36354007),
	(37195861), (37265642), (38033121), (38289717), (38670435), (39256679), (39507162), (39892082), (39978267), (40240595),
	(40374923), (40384720), (40453765), (40640057), (41218256), (41392891), (41462083), (41762634), (42035044), (42348802),
	(42463414), (43237273), (43586926), (44287299), (45121025), (45231177), (45547649), (45894482), (46474915), (46657337),
	(46696593), (46986414), (47879985), (48305365), (48579379), (49127943), (49218300), (49791927), (49881766), (50005633),
	(50259460), (50287060), (50930991), (51228280), (51828629), (52040216), (52077741), (52584282), (52624755), (52824910),
	(53606874), (54098121), (54415063), (54959865), (55550921), (55615891), (55821894), (56223084), (56585883), (57617178),
	(58192742), (58932615), (59383041), (59793705), (60493189), (61204971), (62337487), (62340868), (62397231), (62651957),
	(62762898), (63060238), (63162310), (63308047), (64428736), (64631466), (64788463), (65240384), (65475294), (65570596),
	(66362965), (66516792), (66602787), (66672569), (66889139), (67284908), (67724379), (68215963), (68516705), (68815132),
	(68846917), (68928540), (69140098), (69669405), (69937550), (70095154), (70781052), (71413901), (71625222), (73398797),
	(73481154), (75064463), (75347539), (75390004), (75499502), (75582395), (76184692), (76634149), (76812113), (77207191),
	(77456781), (77585513), (78060096), (78193831), (78371393), (79856792), (79870141), (79979666), (80316585), (80344569),
	(80813021), (81197327), (81896370), (83121692), (84327329), (84834865), (86188410), (87756343), (87796900), (88819587),
	(88979991), (89091579), (89252153), (89272878), (89312388), (89621922), (89631139), (89904598), (89943723), (90357090),
	(90654356), (90790253), (90876561), (91152256), (91512835), (91932350), (91939608), (91998119), (93013676), (93221206),
	(93889755), (94004268), (94119974), (94568601), (94905343), (95231062), (95492061), (95600067), (95727991), (97127906),
	(97360116), (97590747), (97612389), (98266377), (98434877), (98502113), (99261403), (99551425), (99724761), (99785935)
on conflict (card_id) do nothing;

-- Ownership can now only reference an allow-listed card. This is the guarantee
-- the client-side filters cannot give: it holds for a hand-rolled REST call, a
-- stale tab running last week's build, or a future code path that forgets the
-- rule. It is added after the collection reset in the previous migration, which
-- is what leaves no violating row behind.
alter table public.player_cards
	drop constraint if exists player_cards_available_fkey;

alter table public.player_cards
	add constraint player_cards_available_fkey
	foreign key (card_id) references public.available_cards (card_id);

-- Grant cards to the calling user, incrementing quantities atomically. The input
-- may contain repeats (e.g. rolling ten random cards that collide); they are
-- aggregated per id before the upsert. Runs as the invoker, so RLS still applies
-- and a user can only ever grant cards to themselves.
--
-- Unchanged from the player_cards migration except for the allow-list check: the
-- foreign key above would reject a bad id anyway, but it would do it with an
-- opaque constraint violation naming no card. Checking first turns that into a
-- message that says which id was refused.
create or replace function public.grant_cards(card_ids bigint[])
	returns void
	language plpgsql
	security invoker
	set search_path = public
as $$
declare
	uid uuid := auth.uid();
	bad bigint;
begin
	if uid is null then
		raise exception 'not authenticated';
	end if;

	select c into bad
	from unnest(card_ids) as c
	where not exists (select 1 from public.available_cards a where a.card_id = c)
	limit 1;

	if bad is not null then
		raise exception 'card % is not available in the game', bad;
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
grant select on public.available_cards to anon, authenticated;
