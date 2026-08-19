/**
 * lib.js — shared GLSL chunks.
 *
 * Kept as JS template strings rather than .glsl files so shaders can be
 * composed (and so the build needs no extra loader plugin).
 */

/* Ashima-style 3D simplex noise — the workhorse behind curl flow, the
   reactor turbulence, the caustics and the tunnel iridescence. */
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p){
  float f = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { f += a * snoise(p); p *= 2.02; a *= 0.5; }
  return f;
}
`;

/** Curl of a noise field — divergence-free, so particles swirl instead of clumping. */
export const CURL = /* glsl */ `
vec3 curlNoise(vec3 p){
  const float e = 0.12;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = snoise(p - dx), x1 = snoise(p + dx);
  float y0 = snoise(p - dy), y1 = snoise(p + dy);
  float z0 = snoise(p - dz), z1 = snoise(p + dz);

  vec3 pa = p + vec3(31.416, 47.853, 11.234);
  float ax0 = snoise(pa - dy), ax1 = snoise(pa + dy);
  float az0 = snoise(pa - dz), az1 = snoise(pa + dz);

  vec3 pb = p + vec3(-19.271, 7.117, 63.902);
  float bx0 = snoise(pb - dx), bx1 = snoise(pb + dx);
  float by0 = snoise(pb - dy), by1 = snoise(pb + dy);

  float invE = 1.0 / (2.0 * e);
  return vec3(
    ((ax1 - ax0) - (z1 - z0)) * invE,
    ((bx1 - bx0) - (x1 - x0)) * invE,
    ((y1 - y0) - (by1 - by0)) * invE
  );
}
`;

/** Rotation + hue helpers used across the scene. */
export const UTILS = /* glsl */ `
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, c*p.y - s*p.z, s*p.y + c*p.z); }

vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2  hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

/* thin-film / oil-slick iridescence keyed on view angle */
vec3 iridescence(float t){
  return 0.5 + 0.5 * cos(6.28318 * (vec3(1.0, 1.0, 1.0) * t + vec3(0.0, 0.33, 0.67)));
}

float saturate(float x){ return clamp(x, 0.0, 1.0); }
`;

/** Hex-grid distance field, used by both the Lab tunnel and the lab card. */
export const HEX = /* glsl */ `
/* returns xy = local coords in cell, z = distance to nearest edge, w = cell id hash */
vec4 hexCell(vec2 p){
  vec2 s = vec2(1.0, 1.7320508);
  vec2 hC = floor(vec2(p.x / s.x, p.y / s.y)) + 0.5;
  vec2 hA = (p - hC * s);
  vec2 hB = (p - (hC + 0.5) * s);

  vec4 res = dot(hA, hA) < dot(hB, hB)
    ? vec4(hA, hC)
    : vec4(hB, hC + 0.5);

  vec2 q = abs(res.xy);
  float d = 0.5 - max(q.x * 0.8660254 + q.y * 0.5, q.y);
  return vec4(res.xy, d, dot(res.zw, vec2(37.1, 61.7)));
}
`;

/** Fullscreen-triangle vertex shader used by every post pass. */
export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
