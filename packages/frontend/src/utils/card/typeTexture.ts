// Map a YGOPRODeck card `type` string to the background texture that matches its
// card type — covering every category: monster varieties, spells, traps and
// tokens. Keyword order matters: compound types (e.g. "Ritual Effect Monster",
// "XYZ Pendulum Effect Monster") are resolved to their most specific frame by
// checking the more distinctive keywords first. Non-monster keywords ("Spell",
// "Trap") never appear inside a monster's `type`, so they can't mismatch.
const TYPE_TEXTURES: Array<[keyword: string, texture: string]> = [
	['Xyz', '/textures/xyz.png'],
	['Synchro', '/textures/synchro.png'],
	['Link', '/textures/link.jpg'],
	['Ritual', '/textures/ritual.png'],
	['Fusion', '/textures/fusion.png'],
	['Pendulum', '/textures/pendulum.png'],
	['Token', '/textures/token.png'],
	['Spell', '/textures/spell.png'],
	['Trap', '/textures/trap.png'],
	['Normal', '/textures/normal.png'],
	['Effect', '/textures/effect.png']
];

// Fallback for any type that doesn't match a known keyword (Tuner, Gemini,
// Union, Spirit, Toon, Skill, …) — treated as a plain effect frame.
const DEFAULT_TEXTURE = '/textures/effect.png';

export function textureForType(type: string | null | undefined): string {
	if (!type) return DEFAULT_TEXTURE;

	const normalized = type.toLowerCase();

	for (const [keyword, texture] of TYPE_TEXTURES) {
		if (normalized.includes(keyword.toLowerCase())) return texture;
	}

	return DEFAULT_TEXTURE;
}
