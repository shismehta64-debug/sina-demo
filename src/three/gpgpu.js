import * as THREE from 'three';

/**
 * gpgpu.js — minimal ping-pong FBO compute.
 *
 * Hand-rolled rather than pulled from three's examples: we only need a pair of
 * float render targets per variable, a fullscreen triangle, and a swap. Each
 * variable can read every other variable's *previous* frame, which is all the
 * particle integrator asks for.
 */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class GPGPU {
  constructor(renderer, size) {
    this.renderer = renderer;
    this.size = size;

    // Prefer full float; half-float positions visibly quantise at world scale.
    const gl = renderer.getContext();
    const isGL2 = renderer.capabilities.isWebGL2;
    const canFloat = isGL2
      ? !!gl.getExtension('EXT_color_buffer_float')
      : !!gl.getExtension('OES_texture_float');
    this.type = canFloat ? THREE.FloatType : THREE.HalfFloatType;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geo = new THREE.BufferGeometry();
    // single oversized triangle — no diagonal seam, one less vertex
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.mesh = new THREE.Mesh(this.geo, null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    this.vars = new Map();
  }

  makeTarget() {
    return new THREE.WebGLRenderTarget(this.size, this.size, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: this.type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  /** Create a simulated variable seeded from a Float32Array of RGBA data. */
  addVariable(name, fragmentShader, uniforms, seedData) {
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const seed = new THREE.DataTexture(seedData, this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
    seed.needsUpdate = true;
    seed.minFilter = seed.magFilter = THREE.NearestFilter;

    const v = { name, material, rt: [this.makeTarget(), this.makeTarget()], idx: 0, seed };
    this.vars.set(name, v);

    // prime both buffers with the seed so frame 0 reads valid data
    this._blit(seed, v.rt[0]);
    this._blit(seed, v.rt[1]);
    return v;
  }

  _blit(texture, target) {
    if (!this._copyMat) {
      this._copyMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: `uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }`,
        uniforms: { tSrc: { value: null } },
        depthTest: false, depthWrite: false,
      });
    }
    this._copyMat.uniforms.tSrc.value = texture;
    this.mesh.material = this._copyMat;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
  }

  /** Current (readable) texture for a variable. */
  read(name) {
    const v = this.vars.get(name);
    return v.rt[v.idx].texture;
  }

  /** Run one step of a variable. `wire` fills in cross-variable uniforms. */
  compute(name, wire) {
    const v = this.vars.get(name);
    const dst = v.rt[1 - v.idx];
    if (wire) wire(v.material.uniforms);
    this.mesh.material = v.material;

    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);

    v.idx = 1 - v.idx;
  }

  dispose() {
    this.vars.forEach((v) => {
      v.rt[0].dispose(); v.rt[1].dispose();
      v.material.dispose(); v.seed.dispose();
    });
    this.geo.dispose();
    this._copyMat?.dispose();
  }
}
