import * as THREE from 'three';
export function filmRandom(seed,id=''){
 let n=seed>>>0;for(let i=0;i<id.length;i++)n=Math.imul(n^id.charCodeAt(i),16777619)>>>0;
 return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
}
export function getFilmView(frame,context,current){
 const pose=context?.frameAt?.(frame.start)??current;if(pose?.isCamera){const locked=pose.clone();locked.updateMatrixWorld();return locked;}
 const view=new THREE.PerspectiveCamera(pose?.fov??current.fov,pose?.aspect??current.aspect,.1,10000);
 view.position.copy(pose?.position??current.position);if(pose?.target)view.lookAt(pose.target);else view.quaternion.copy(pose?.quaternion??current.quaternion);view.updateMatrixWorld();return view;
}
/** 只检查与目标时间相交的批次，不补跑片头；出生时刻决定轨迹随机流。 */
export function sampleMeteorEpisode(frame,{seed=0,view}){
 const p=frame.parameters??{},count=p.burstCount??9,limit=p.maxActive??32,time=frame.localTime,interval=p.burstInterval??4,flight=p.flightDuration??1.1,linger=p.lingerDuration??.3,result=[];
 if(!count||!limit||p.mode==='off')return result;
 const last=Math.floor(time/interval),first=Math.max(0,Math.floor((time-flight-linger-.75)/interval));
 const forward=new THREE.Vector3(),east=new THREE.Vector3().setFromMatrixColumn(view.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(view.matrixWorld,1);view.getWorldDirection(forward);
 const half=Math.tan(THREE.MathUtils.degToRad(view.getEffectiveFOV())*.5),aspect=view.aspect,bearing=THREE.MathUtils.degToRad(p.bearing??-55),dx=Math.cos(bearing)/aspect,dy=Math.sin(bearing);
 for(let batch=last;batch>=first&&result.length<limit;batch--)for(let i=count-1;i>=0&&result.length<limit;i--){
  const random=filmRandom(seed,`${frame.id}:${batch}:${i}`),born=batch*interval+i*.17*Math.min(1,3/count),age=time-born;if(age<0||age>=flight+linger)continue;
  const x=(random()-.5)*.7,y=(random()-.5)*.3,edge=1.2;
  const before=Math.min((edge-y)/-dy,Math.abs(dx)>1e-6?(edge+Math.sign(dx)*x)/Math.abs(dx):Infinity),after=Math.min((-edge-y)/dy,Math.abs(dx)>1e-6?(edge-Math.sign(dx)*x)/Math.abs(dx):Infinity);
  const start=forward.clone().addScaledVector(east,(x-dx*before)*half*aspect).addScaledVector(up,(y-dy*before)*half).normalize(),end=forward.clone().addScaledVector(east,(x+dx*after)*half*aspect).addScaledVector(up,(y+dy*after)*half).normalize(),mass=random();
  result.push({active:true,born,flight,linger,start,travel:start.angleTo(end),away:end.addScaledVector(start,-start.dot(end)).normalize(),width:3.8+mass*2.6,size:6+mass*6,brightness:(1.15+mass*.65)*(p.brightness??1),trailFraction:.55+random()*.18,color:new THREE.Color().setRGB(1,.96+random()*.03,.84+random()*.1)});
 }
 return result.reverse();
}
