// Pure geometry and quaternion helpers for rendering a six-sided die as real 3D
// geometry on a 2D canvas. No rendering here - just the math the canvas needs:
// the cube's vertices/faces, quaternion rotation, and the resting orientation
// that puts a chosen face value pointing "up" toward the camera.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

// --- Quaternions -----------------------------------------------------------

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
	const half = angle / 2;
	const s = Math.sin(half);
	return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

export function quatMul(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
	];
}

export function quatNormalize(q: Quat): Quat {
	const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

// Rotate a vector by a quaternion: v + 2w(q×v) + 2(q×(q×v)).
export function rotateVec(q: Quat, v: Vec3): Vec3 {
	const [qx, qy, qz, qw] = q;
	const tx = 2 * (qy * v[2] - qz * v[1]);
	const ty = 2 * (qz * v[0] - qx * v[2]);
	const tz = 2 * (qx * v[1] - qy * v[0]);
	return [
		v[0] + qw * tx + (qy * tz - qz * ty),
		v[1] + qw * ty + (qz * tx - qx * tz),
		v[2] + qw * tz + (qx * ty - qy * tx)
	];
}

// Spherical linear interpolation, taking the shortest arc.
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
	let [bx, by, bz, bw] = b;
	let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
	if (dot < 0) {
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
		dot = -dot;
	}
	if (dot > 0.9995) {
		return quatNormalize([
			a[0] + (bx - a[0]) * t,
			a[1] + (by - a[1]) * t,
			a[2] + (bz - a[2]) * t,
			a[3] + (bw - a[3]) * t
		]);
	}
	const theta = Math.acos(dot);
	const sin = Math.sin(theta);
	const wa = Math.sin((1 - t) * theta) / sin;
	const wb = Math.sin(t * theta) / sin;
	return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

// --- Cube geometry ---------------------------------------------------------

// Unit cube corners (half-size 1).
export const CUBE_VERTICES: Vec3[] = [
	[-1, -1, -1], // 0
	[1, -1, -1], // 1
	[1, 1, -1], // 2
	[-1, 1, -1], // 3
	[-1, -1, 1], // 4
	[1, -1, 1], // 5
	[1, 1, 1], // 6
	[-1, 1, 1] // 7
];

export interface CubeFace {
	value: number; // pip count on this face (opposite faces sum to 7)
	indices: [number, number, number, number]; // CCW when viewed from outside
	normal: Vec3;
	right: Vec3; // in-plane axis for pip layout
	up: Vec3; // in-plane axis for pip layout
}

export const CUBE_FACES: CubeFace[] = [
	{ value: 1, indices: [4, 5, 6, 7], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
	{ value: 6, indices: [1, 0, 3, 2], normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
	{ value: 3, indices: [5, 1, 2, 6], normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
	{ value: 4, indices: [0, 4, 7, 3], normal: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
	{ value: 2, indices: [7, 6, 2, 3], normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
	{ value: 5, indices: [0, 1, 5, 4], normal: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] }
];

// Pip positions in face-local (u, v) coordinates, range roughly [-0.66, 0.66].
const P = 0.66;
const PIP_LAYOUTS: Record<number, Array<[number, number]>> = {
	1: [[0, 0]],
	2: [[-P, P], [P, -P]],
	3: [[-P, P], [0, 0], [P, -P]],
	4: [[-P, -P], [-P, P], [P, -P], [P, P]],
	5: [[-P, -P], [-P, P], [0, 0], [P, -P], [P, P]],
	6: [[-P, -P], [-P, 0], [-P, P], [P, -P], [P, 0], [P, P]]
};

export function pipLayout(value: number): Array<[number, number]> {
	return PIP_LAYOUTS[value] ?? [];
}

// Orientation that brings the given face value's normal to +Y (world up).
function faceUpQuat(value: number): Quat {
	switch (value) {
		case 1:
			return quatFromAxisAngle([1, 0, 0], -Math.PI / 2); // +Z -> +Y
		case 2:
			return QUAT_IDENTITY; // +Y already up
		case 3:
			return quatFromAxisAngle([0, 0, 1], Math.PI / 2); // +X -> +Y
		case 4:
			return quatFromAxisAngle([0, 0, 1], -Math.PI / 2); // -X -> +Y
		case 5:
			return quatFromAxisAngle([1, 0, 0], Math.PI); // -Y -> +Y
		case 6:
			return quatFromAxisAngle([1, 0, 0], Math.PI / 2); // -Z -> +Y
		default:
			return QUAT_IDENTITY;
	}
}

// Resting orientation that points the given face value's normal at the camera
// (+Z) so the rolled face sits flat-on and fully in view, and rolls it so the
// face's own up axis points to +Y - keeping a numeral drawn on it upright.
export function faceFrontQuat(value: number): Quat {
	// Take the face to "up", then tip it forward (+Y -> +Z) toward the viewer.
	const base = quatMul(quatFromAxisAngle([1, 0, 0], Math.PI / 2), faceUpQuat(value));
	const face = CUBE_FACES.find((f) => f.value === value);
	if (!face) return base;
	// Roll about the view axis so the face's up axis lands at screen up (+Y).
	const up = rotateVec(base, face.up);
	const phi = Math.PI / 2 - Math.atan2(up[1], up[0]);
	return quatNormalize(quatMul(quatFromAxisAngle([0, 0, 1], phi), base));
}
