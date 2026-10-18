const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function level(x,z,time){
  const along=Math.sin(x*.085+z*.063)*.52+Math.sin(x*.041-z*.11)*.3;
  const pulse=.5+.5*Math.sin(time*.85+along*.85);
  return .015+.4*pulse*pulse;
}

/** Shared shoreline water pulse: metres, with a delayed wet-sand envelope. */
export function getBeachSwash(x,z,time,{depth=0,exposure=1,typhoon=0}={}){
  const height=level(x,z,time)*(1-smooth(.8,2.4,depth))*(.55+.45*exposure)*(1-.9*typhoon);
  const wetLevel=Math.max(level(x,z,time),level(x,z,time-1.25))+.07;
  return {height,wetLevel};
}

export const BEACH_SWASH_GLSL=/* glsl */`
  float beachSwashLevel(vec2 p,float time){
    float along=sin(p.x*0.085+p.y*0.063)*0.52+sin(p.x*0.041-p.y*0.11)*0.3;
    float pulse=0.5+0.5*sin(time*0.85+along*0.85);
    return 0.015+0.4*pulse*pulse;
  }
  float beachSwashHeight(vec2 p,float time,float depth,float exposure,float typhoon){
    return beachSwashLevel(p,time)*(1.0-smoothstep(0.8,2.4,depth))
      *mix(0.55,1.0,exposure)*(1.0-typhoon*0.9);
  }
  float beachWetLevel(vec2 p,float time){
    return max(beachSwashLevel(p,time),beachSwashLevel(p,time-1.25))+0.07;
  }
`;
