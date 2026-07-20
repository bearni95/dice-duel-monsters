// Map a YGOPRODeck card `attribute` string to its attribute icon. Monsters carry
// one of the seven elemental attributes (Dark, Divine, Earth, Fire, Light, Water,
// Wind); spell and trap cards use their own icons. The match is case-insensitive
// since the raw data stores attributes uppercase ("DARK", "FIRE", …).
const ATTRIBUTE_ICONS: Record<string, string> = {
	dark: '/assets/attributes/dark.png',
	divine: '/assets/attributes/divine.png',
	earth: '/assets/attributes/earth.png',
	fire: '/assets/attributes/fire.png',
	light: '/assets/attributes/light.png',
	water: '/assets/attributes/water.png',
	wind: '/assets/attributes/wind.png',
	spell: '/assets/attributes/spell.png',
	trap: '/assets/attributes/trap.png'
};

// Returns the icon path for a card's attribute, or null when the attribute is
// absent or unrecognized (e.g. blank on many spell/trap cards) so callers can
// simply skip rendering the icon.
export function attributeIcon(attribute: string | null | undefined): string | null {
	if (!attribute) return null;
	return ATTRIBUTE_ICONS[attribute.toLowerCase()] ?? null;
}
