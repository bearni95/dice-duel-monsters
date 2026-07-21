#!/usr/bin/env bash
#
# Squares every monster-billboard PNG in place.
#
# For each image the canvas is expanded to a square whose side equals the
# image's longer edge. The shorter axis is padded with transparency, and the
# original art is anchored to the bottom-center of the new square (gravity
# south = horizontally centered, vertically bottom-aligned). Already-square
# images are left untouched.
#
# Reversible: these files are git-tracked, so `git checkout -- <dir>` restores
# the originals.

set -euo pipefail

# Default to the frontend package's served billboards, resolved from this
# script's location so the tool works regardless of the caller's cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${1:-$SCRIPT_DIR/../../frontend/static/cards/monster-billboards}"

if [[ ! -d "$DIR" ]]; then
	echo "Directory not found: $DIR" >&2
	exit 1
fi

square_one() {
	local f="$1"
	# 1. -trim strips the transparent margins the billboards ship with (the
	#    creature usually floats high with empty space below it), so the visible
	#    art becomes flush with the canvas edges.
	# 2. Expand the trimmed art to a square of side max(w,h), padding the short
	#    axis with transparency and anchoring the art to bottom-center (gravity
	#    south) so the creature sits on the bottom edge, horizontally centered.
	magick "$f" \
		-background none \
		-trim +repage \
		-gravity south \
		-extent '%[fx:max(w,h)]x%[fx:max(w,h)]' \
		"$f"
}
export -f square_one

count=$(find "$DIR" -type f -name '*.png' | wc -l | tr -d ' ')
echo "Squaring $count PNG(s) in $DIR ..."

find "$DIR" -type f -name '*.png' -print0 \
	| xargs -0 -P 8 -I {} bash -c 'square_one "$@"' _ {}

echo "Done."
