import {sampleTyphoonWave} from './typhoon-waves.js';
import {getBeachSwash} from './beach-swash.js';
import {getOffshoreBlend} from './ocean-optics.js';

const bands=[[.12,76,.90,8.3,2.3],[-.37,44,.58,7,5.9],[.58,28,.40,5.2,9.2],[-.72,18,.25,4.2,13.7],
  [.34,9.6,.125,3.1,17.4],[-1.12,5,.065,2.3,21.6],[1.48,3,.035,1.9,27.1],[1.18,62,.35,7.6,31.8]];
const fract=x=>x-Math.floor(x);
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function hash(x,y){let a=fract(x*.1031),b=fract(y*.1031),c=a;
  const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);a+=d;b+=d;c+=d;return fract((a+b)*c);}
function noise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y),u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}

/** CPU counterpart of the displaced sea close to a camera, including its surge. */
export function sampleCameraWaterHeight(x,z,time,waveTime,windAngle,depth,exposure,weather,landMask=1,cameraDistance=0) {
  const swash=getBeachSwash(x,z,time,{depth,exposure,typhoon:weather.typhoon}).height*landMask;
  if(depth<=0)return swash;
  const energy=.72+weather.wind*1.08+weather.storm*.65+weather.swell*.48+weather.gust*.2;
  const coast=smooth(.1,6,depth)*(1+(1-smooth(3,12,depth))*.3)*exposure*(1-.72*smooth(180,1000,cameraDistance));
  const spacing=Math.max(Math.hypot(x,z)*.04,.2);
  let height=0;
  for(const [turn,length,amplitude,speed,seed] of bands) {
    const dx=Math.cos(windAngle+turn),dz=Math.sin(windAngle+turn),k=Math.PI*2/length;
    const phase=noise(x*.024+dx*seed+time*.005,z*.024+dz*seed-time*.003);
    const group=noise(x*.008-dx*waveTime*.014+seed,z*.008-dz*waveTime*.014+seed*.37);
    const resolved=1-smooth(length*.22,length*.55,spacing);
    const a=Math.min(amplitude*coast*resolved*energy*(.62+group*.63),Math.max(0,depth-.1)*.04*exposure);
    height+=a*Math.sin(k*(dx*x+dz*z-speed*waveTime)+(phase-.5)*2.6+seed);
  }
  height+=sampleTyphoonWave(x,z,waveTime,[Math.cos(windAngle),Math.sin(windAngle)],depth,exposure,weather.typhoon)*landMask;
  return Math.max(0,height+swash);
}

/** Upper surface of nearby rendered triangles, including horizontal Gerstner drift.
 * Vertex maxima bound their interpolated surface without a full per-frame mesh scan.
 */
export function createCameraWaterSampler(geometry,bathymetry,extent=240) {
  const positions=geometry.attributes.position;
  const slices=256,stride=slices+1,rings=(positions.count-1)/stride;
  const radii=Array.from({length:rings},(_,i)=>positions.getX(1+i*stride));
  const {data,width:size}=bathymetry.image;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function channel(x,z,c) {
    const u=(x/(extent*2)+.5)*size-.5,v=(z/(extent*2)+.5)*size-.5;
    const ix=Math.floor(u),iz=Math.floor(v),fx=u-ix,fz=v-iz;
    const a=(clamp(iz,0,size-1)*size+clamp(ix,0,size-1))*4+c;
    const b=(clamp(iz,0,size-1)*size+clamp(ix+1,0,size-1))*4+c;
    const d=(clamp(iz+1,0,size-1)*size+clamp(ix,0,size-1))*4+c;
    const e=(clamp(iz+1,0,size-1)*size+clamp(ix+1,0,size-1))*4+c;
    return ((data[a]*(1-fx)+data[b]*fx)*(1-fz)+(data[d]*(1-fx)+data[e]*fx)*fz)/255;
  }
  return function sample(x,z,time,waveTime,windAngle,weather) {
    const radius=Math.hypot(x,z);
    // Sum of all horizontal caps is <3.4m; include the camera's near-plane footprint.
    const padding=4.5;
    let lo=0,hi=rings;
    while(lo<hi){const mid=(lo+hi)>>1;if(radii[mid]<radius-padding)lo=mid+1;else hi=mid;}
    const first=Math.max(0,lo-1);
    let last=first;while(last<rings-1&&radii[last]<radius+padding)last++;
    const angle=Math.atan2(z,x),step=Math.PI*2/slices;
    const spread=radius<=padding?Math.PI:Math.asin(Math.min(1,padding/Math.max(radius-padding,.001)));
    const start=Math.floor((angle-spread)/step),end=Math.ceil((angle+spread)/step);
    let highest=0;
    function vertex(vx,vz) {
      const outside=Math.max(Math.abs(vx),Math.abs(vz))>extent;
      const edge=getOffshoreBlend(vx,vz,extent);
      const depth=outside?48:channel(vx,vz,0)*48*(1-edge)+48*edge;
      const exposure=outside?1:channel(vx,vz,3)*(1-edge)+edge;
      const landMask=1-smooth(.2,2.8,channel(vx,vz,2)*160-80);
      highest=Math.max(highest,sampleCameraWaterHeight(vx,vz,time,waveTime,windAngle,depth,exposure,weather,landMask,Math.hypot(vx-x,vz-z)));
    }
    if(first===0)vertex(0,0);
    for(let ring=first;ring<=last;ring++)for(let slice=start;slice<=end;slice++) {
      const index=1+ring*stride+((slice%slices)+slices)%slices;
      vertex(positions.getX(index),positions.getZ(index));
    }
    return highest;
  };
}
