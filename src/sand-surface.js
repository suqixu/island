const DUNE_HEIGHT = .012, MOUND_HEIGHT = .036, DETAIL_HEIGHT = .0015, GRAIN_HEIGHT = .002;
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const resolved = (footprint, wavelength) => 1 - smooth(wavelength * .25, wavelength * .75, footprint);
const fract = value => value - Math.floor(value);
const hash = (x,z) => fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
const fade = value => value ** 3 * (value * (value * 6 - 15) + 10);
function sandNoise(x,z) {
  const ix=Math.floor(x),iz=Math.floor(z),u=fade(fract(x)),v=fade(fract(z));
  const a=hash(ix,iz),b=hash(ix+1,iz),c=hash(ix,iz+1),d=hash(ix+1,iz+1);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}

/** Stable, irregular soft sand; never advance the random pattern with time. */
export function getSandRelief(x, z, { grain = .5, wetness = 0, footprint = 0 } = {}) {
  const wet = Math.max(0, Math.min(1, wetness));
  const qx=x+Math.sin(z*.72+Math.sin(x*.39)*2)*.48+Math.sin(x*.23+z*.31)*.31;
  const qz=z+Math.sin(x*.67+Math.sin(z*.44)*1.8)*.52-Math.sin(x*.27-z*.19)*.29;
  const dune=(sandNoise(x*.31+41,z*.31-19)-.5)*2;
  const mound=(sandNoise(qx*2.1,qz*2.1)*.72
    +sandNoise(-qz*3.7+qx*.8+19,qx*3.7+qz*.8-7)*.28-.5)*2;
  const detail=(sandNoise(qx*9.3+qz*3.7,qz*9.3-qx*3.7)-.5)*2;
  return dune * DUNE_HEIGHT * resolved(footprint, 6) * (1 - wet * .65)
    + mound * MOUND_HEIGHT * resolved(footprint, .9) * (1 - wet * .75)
    + detail * DETAIL_HEIGHT * resolved(footprint, .33) * (1 - wet * .8)
    + (grain - .5) * GRAIN_HEIGHT * resolved(footprint, .018) * (1 - wet * .65);
}

export const SAND_SURFACE_GLSL = /* glsl */ `
  float sandResolved(float footprint, float wavelength) {
    return 1.0 - smoothstep(wavelength * 0.25, wavelength * 0.75, footprint);
  }
  float softSandHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
  float softSandNoise(vec2 p) {
    vec2 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.0-15.0)+10.0);
    return mix(mix(softSandHash(i),softSandHash(i+vec2(1.0,0.0)),u.x),
      mix(softSandHash(i+vec2(0.0,1.0)),softSandHash(i+vec2(1.0)),u.x),u.y);
  }
  float coastalSandRelief(vec2 p, float footprint, float wetness, float grain) {
    float wet = clamp(wetness, 0.0, 1.0);
    // Warping and independently rotated random layers break the old diamond lattice.
    vec2 q=p+vec2(sin(p.y*0.72+sin(p.x*0.39)*2.0)*0.48+sin(p.x*0.23+p.y*0.31)*0.31,
      sin(p.x*0.67+sin(p.y*0.44)*1.8)*0.52-sin(p.x*0.27-p.y*0.19)*0.29);
    float dune=(softSandNoise(p*0.31+vec2(41.0,-19.0))-0.5)*2.0;
    float mound=(softSandNoise(q*2.1)*0.72
      +softSandNoise(vec2(-q.y*3.7+q.x*0.8+19.0,q.x*3.7+q.y*0.8-7.0))*0.28-0.5)*2.0;
    float detail=(softSandNoise(vec2(q.x*9.3+q.y*3.7,q.y*9.3-q.x*3.7))-0.5)*2.0;
    return dune * ${DUNE_HEIGHT.toFixed(4)} * sandResolved(footprint, 6.0) * (1.0 - wet * 0.65)
      + mound * ${MOUND_HEIGHT.toFixed(4)} * sandResolved(footprint, 0.9) * (1.0 - wet * 0.75)
      + detail * ${DETAIL_HEIGHT.toFixed(4)} * sandResolved(footprint, 0.33) * (1.0 - wet * 0.8)
      + (grain - 0.5) * ${GRAIN_HEIGHT.toFixed(4)} * sandResolved(footprint, 0.018) * (1.0 - wet * 0.65);
  }
`;
