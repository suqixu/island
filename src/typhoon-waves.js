// A dominant swell meets two shorter, oblique wind seas. Depth limits the
// surface after shoaling; a shallow crest collapses instead of lifting the bay.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = x => x - Math.floor(x);
function breakerHash(x,y) {
  let a=fract(x*.1031),b=fract(y*.1031),c=a;
  const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);
  a+=d;b+=d;c+=d;
  return fract((a+b)*c);
}
function breakerNoise(x,y) {
  const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y);
  const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const a=breakerHash(ix,iy),b=breakerHash(ix+1,iy),c=breakerHash(ix,iy+1),d=breakerHash(ix+1,iy+1);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}
function surgePhase(along, across, time) {
  const phase=(along-12*time)*(Math.PI*2/108)
    +Math.sin(across*.022+Math.sin(along*.009)*1.2)*.55+Math.sin(across*.061-time*.16)*.24;
  return phase+.45*Math.cos(phase);
}
export function sampleTyphoonWave(x, z, time, direction, depth, exposure, strength) {
  if (strength === 0 || depth <= 0) return 0;
  const along = x * direction[0] + z * direction[1];
  const across = -x * direction[1] + z * direction[0];
  const phase = surgePhase(along,across,time);
  const group = .64 + .22 * Math.cos((along - 8 * time) * .014) + .14 * Math.sin(across * .025 + time * .2);
  const shoal=1+.18*(1-smooth(8,25,depth));
  const crossing=1.9*Math.sin((along*.91+across*.42-8.6*time)*(Math.PI*2/61)+.6*Math.sin(across*.04))
    +.95*Math.sin((along*.77-across*.64-6.4*time)*(Math.PI*2/37)+1.7);
  const resolved=1-smooth(5,18,Math.max(Math.hypot(x,z)*.04,.2));
  const shape=.36*Math.cos(phase)*(1-resolved)+(Math.pow(.5+.5*Math.cos(phase),3)-.295)*resolved;
  const raw=18*group*shoal*shape+crossing*resolved;
  const limit=depth*.72;
  return raw*limit/Math.sqrt(limit*limit+raw*raw)*exposure*strength;
}

// Break along isolated crest sections. The slower patch field tears a front
// into unequal lengths; a falling crest leaves foam that outlives its impact.
export function sampleTyphoonBreaker(x,z,time,direction,depth,exposure,strength,output={}) {
  const along=x*direction[0]+z*direction[1],across=-x*direction[1]+z*direction[0];
  const phase=surgePhase(along,across,time);
  const nx=along*.085-time*.17,ny=across*.085;
  const field=breakerNoise(nx,ny)*.65+breakerNoise(nx*2.07+13.2,ny*2.07+7.1)*.35;
  const sectionMask=smooth(.36,.76,field);
  const crest=Math.pow(.5+.5*Math.cos(phase),12);
  const front=smooth(.02,.28,Math.sin(phase))*crest;
  const behind=-Math.atan2(Math.sin(phase),Math.cos(phase));
  const wake=smooth(.05,.5,behind)*(1-smooth(.75,2.2,behind));
  output.height=sampleTyphoonWave(x,z,time,direction,depth,exposure,strength);
  output.breaking=front*sectionMask*strength*exposure;
  output.foam=(front*sectionMask*.8+wake*smooth(.35,.75,field)*.38)*strength*exposure;
  output.impact=output.breaking*smooth(.4,1.6,Math.max(0,output.height))
    *(1-smooth(3,8,depth))*exposure*exposure;
  return output;
}

export const TYPHOON_WAVES_GLSL = /* glsl */ `
  float breakerHash(vec2 p) {
    vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);
  }
  float breakerNoise(vec2 p) {
    vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
    return mix(mix(breakerHash(i),breakerHash(i+vec2(1.0,0.0)),u.x),
      mix(breakerHash(i+vec2(0.0,1.0)),breakerHash(i+vec2(1.0)),u.x),u.y);
  }
  float surgePhase(float along,float across) {
    float phase=(along-12.0*uWaveTime)*(6.28318530718/108.0)
      +sin(across*0.022+sin(along*0.009)*1.2)*0.55+sin(across*0.061-uWaveTime*0.16)*0.24;
    return phase+0.45*cos(phase);
  }
  float surgeHeight(vec2 base, float depth, float exposure) {
    if(depth<=0.0) return 0.0;
    float along = dot(base, uWindDirection);
    float across = dot(base, vec2(-uWindDirection.y, uWindDirection.x));
    float phase = surgePhase(along,across);
    float group = 0.64 + 0.22 * cos((along - 8.0 * uWaveTime) * 0.014) + 0.14 * sin(across * 0.025 + uWaveTime * 0.2);
    float shoal=1.0+0.18*(1.0-smoothstep(8.0,25.0,depth));
    float crossing=1.9*sin((along*0.91+across*0.42-8.6*uWaveTime)*(6.28318530718/61.0)+0.6*sin(across*0.04))
      +0.95*sin((along*0.77-across*0.64-6.4*uWaveTime)*(6.28318530718/37.0)+1.7);
    float resolved=1.0-smoothstep(5.0,18.0,max(length(base)*0.04,0.2));
    float shape=mix(0.36*cos(phase),pow(0.5+0.5*cos(phase),3.0)-0.295,resolved);
    float raw=18.0*group*shoal*shape+crossing*resolved;
    float limit=depth*0.72;
    return raw*limit/sqrt(limit*limit+raw*raw)*exposure*uTyphoon;
  }
  vec3 surgeSurface(vec2 base, float depth, float exposure) {
    float h = surgeHeight(base, depth, exposure);
    return vec3(h, (surgeHeight(base + vec2(0.4, 0.0), depth, exposure) - surgeHeight(base - vec2(0.4, 0.0), depth, exposure)) / 0.8,
                  (surgeHeight(base + vec2(0.0, 0.4), depth, exposure) - surgeHeight(base - vec2(0.0, 0.4), depth, exposure)) / 0.8);
  }
  vec3 surgeBreakup(vec2 base,float depth,float exposure) {
    float along=dot(base,uWindDirection),across=dot(base,vec2(-uWindDirection.y,uWindDirection.x));
    float phase=surgePhase(along,across);
    vec2 n=vec2(along*0.085-uWaveTime*0.17,across*0.085);
    float field=breakerNoise(n)*0.65+breakerNoise(n*2.07+vec2(13.2,7.1))*0.35;
    float sectionMask=smoothstep(0.36,0.76,field);
    float crest=pow(0.5+0.5*cos(phase),12.0);
    float front=smoothstep(0.02,0.28,sin(phase))*crest;
    float behind=-atan(sin(phase),cos(phase));
    float wake=smoothstep(0.05,0.5,behind)*(1.0-smoothstep(0.75,2.2,behind));
    float breaking=front*sectionMask*uTyphoon*exposure;
    float foam=(front*sectionMask*0.8+wake*smoothstep(0.35,0.75,field)*0.38)*uTyphoon*exposure;
    float impact=breaking*smoothstep(0.4,1.6,max(0.0,surgeHeight(base,depth,exposure)))
      *(1.0-smoothstep(3.0,8.0,depth))*exposure*exposure;
    return vec3(breaking,foam,impact);
  }
`;
