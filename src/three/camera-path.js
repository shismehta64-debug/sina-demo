import * as THREE from 'three';

/**
 * camera-path.js — one continuous flight, 0 → 1.
 *
 * Two Catmull-Rom splines (eye and target) are driven by scroll progress. The
 * control points are *keyed*: rather than letting the curve distribute them
 * evenly, a monotone remap ties each key to an exact progress value, so a
 * section always arrives at the beat the layout expects.
 *
 * On top of the spline sit three modulations: pointer parallax, an idle
 * breathing drift so the camera is never truly still, and a shake bus that
 * the reactor and the glitch effects punch.
 */

const KEYS = [
  /* t      eye                       target                    fov  roll */
  [0.000, [ 0.0,  0.2,   6.5],  [ 0.0,  0.25,    0.0],  48, 0.00],
  [0.060, [ 0.4,  0.5,   8.6],  [ 0.0,  0.15,   -1.0],  50, 0.01],
  [0.130, [ 1.5,  1.1,  12.6],  [ 0.0,  0.00,   -3.0],  54, 0.02],
  [0.210, [ 3.7,  0.9,   8.0],  [ 0.0,  0.00,  -14.0],  58, 0.03],
  [0.290, [ 3.0, -0.4,  -1.0],  [ 0.0,  0.00,  -18.0],  60, 0.01],
  [0.370, [-1.6,  1.4, -12.0],  [ 0.0,  0.00,  -26.0],  62, -0.02],
  [0.450, [-5.0,  2.0, -24.0],  [ 0.0,  0.00,  -38.0],  64, -0.04],
  [0.530, [-8.0, -1.0, -34.0],  [ 0.0,  0.00,  -46.0],  62, -0.03],
  [0.590, [-7.0, -4.2, -39.5],  [ 0.0,  0.90,  -46.0],  58, -0.01],
  [0.650, [ 0.5, -4.8, -37.0],  [ 0.0,  0.20,  -46.0],  55,  0.02],
  [0.710, [ 6.6,  1.2, -40.0],  [ 0.0, -1.00,  -52.0],  56,  0.04],
  [0.770, [ 3.0,  3.2, -56.0],  [ 0.0,  0.00,  -70.0],  58,  0.02],
  [0.830, [-4.6,  0.6, -63.0],  [ 2.0,  0.00,  -72.0],  60, -0.02],
  [0.890, [-0.5,  0.2, -73.0],  [ 0.0,  0.00,  -95.0],  66, -0.01],
  [0.930, [ 0.0,  0.0, -92.0],  [ 0.0,  0.00, -114.0],  76,  0.03],
  [0.965, [ 0.0,  0.4,-104.0],  [ 0.0, -0.80, -118.0],  66,  0.01],
  [1.000, [ 0.0,  1.1,-112.0],  [ 0.0, -1.60, -121.0],  54,  0.00],
];

export class CameraPath {
  constructor(camera) {
    this.camera = camera;
    this.times = KEYS.map((k) => k[0]);
    this.fovs = KEYS.map((k) => k[3]);
    this.rolls = KEYS.map((k) => k[4]);

    this.eyeCurve = new THREE.CatmullRomCurve3(
      KEYS.map((k) => new THREE.Vector3(...k[1])), false, 'catmullrom', 0.35,
    );
    this.targetCurve = new THREE.CatmullRomCurve3(
      KEYS.map((k) => new THREE.Vector3(...k[2])), false, 'catmullrom', 0.35,
    );

    this.eye = new THREE.Vector3().copy(this.eyeCurve.points[0]);
    this.look = new THREE.Vector3().copy(this.targetCurve.points[0]);
    this.smoothEye = this.eye.clone();
    this.smoothLook = this.look.clone();

    this.parallax = new THREE.Vector2();
    this._parallaxTarget = new THREE.Vector2();
    this.shake = 0;
    this.progress = 0;
    this.fov = KEYS[0][3];
    this.roll = 0;
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Map scroll progress → curve parameter, honouring the keyed times. */
  _remap(p) {
    const t = this.times;
    const n = t.length;
    p = Math.min(Math.max(p, 0), 1);
    let i = 0;
    while (i < n - 2 && p > t[i + 1]) i++;
    const span = t[i + 1] - t[i] || 1;
    const u = Math.min(Math.max((p - t[i]) / span, 0), 1);
    return { curveT: (i + u) / (n - 1), i, u };
  }

  setParallax(x, y) { this._parallaxTarget.set(x, y); }
  punch(amount = 1) { this.shake = Math.min(2.4, this.shake + amount); }

  update(progress, dt, time) {
    this.progress = progress;
    const { curveT, i, u } = this._remap(progress);

    this.eyeCurve.getPoint(curveT, this.eye);
    this.targetCurve.getPoint(curveT, this.look);

    // fov / roll interpolate on the same keys
    const ease = u * u * (3 - 2 * u);
    this.fov = this.fovs[i] + (this.fovs[i + 1] - this.fovs[i]) * ease;
    this.roll = this.rolls[i] + (this.rolls[i + 1] - this.rolls[i]) * ease;

    // pointer parallax, eased
    this.parallax.x += (this._parallaxTarget.x - this.parallax.x) * Math.min(1, dt * 2.6);
    this.parallax.y += (this._parallaxTarget.y - this.parallax.y) * Math.min(1, dt * 2.6);

    // idle drift — the camera is handheld, never locked off
    const driftX = Math.sin(time * 0.21) * 0.22 + Math.sin(time * 0.13) * 0.13;
    const driftY = Math.cos(time * 0.17) * 0.16 + Math.sin(time * 0.29) * 0.07;

    // shake decays fast
    this.shake *= Math.pow(0.0015, dt);
    if (this.shake < 0.002) this.shake = 0;
    const sh = this.shake;
    const shX = (Math.sin(time * 47.0) + Math.sin(time * 31.7)) * 0.5 * sh * 0.14;
    const shY = (Math.cos(time * 53.3) + Math.sin(time * 37.1)) * 0.5 * sh * 0.14;

    this.eye.x += this.parallax.x * 1.5 + driftX + shX;
    this.eye.y += this.parallax.y * 1.1 + driftY + shY;
    this.look.x += this.parallax.x * 0.55;
    this.look.y += this.parallax.y * 0.4;

    // critically-damped follow so scrubbing never snaps
    const k = 1 - Math.pow(0.0006, dt);
    this.smoothEye.lerp(this.eye, k);
    this.smoothLook.lerp(this.look, k);

    const cam = this.camera;
    cam.position.copy(this.smoothEye);
    cam.lookAt(this.smoothLook);
    cam.rotateZ(this.roll + sh * 0.05);

    /* Keep roughly the horizontal field of view constant. Without this a
       portrait phone crops the world to a slot and the scene reads as noise. */
    const aspectAdjust = cam.aspect < 1.35 ? Math.min(1.75, 1.35 / Math.max(cam.aspect, 0.4)) : 1;
    const targetFov = this.fov * aspectAdjust + sh * 1.5;
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
  }

  /** World-space point under the pointer, on a plane `dist` in front of the eye. */
  pointerWorld(ndcX, ndcY, dist, out) {
    const cam = this.camera;
    out.set(ndcX, ndcY, 0.5).unproject(cam);
    out.sub(cam.position).normalize().multiplyScalar(dist).add(cam.position);
    return out;
  }
}
