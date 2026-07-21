import { ObjectServiceClass } from '$services/classes/object-service.class';
import type { Player } from '$types/player.type';

/**
 * Holds the local player's profile (name + avatar), persisted to localStorage
 * under `object-service:player`. There is a single record; components read it
 * reactively via `playerService.store` and write with `playerService.set`.
 */
export const playerService = new ObjectServiceClass<Player>('player', {
	id: 'local-player',
	name: '',
	avatar: null,
	dice: []
});
