import { Vector3 } from 'three';

/** 检查真实月盘投影，并用地形高度采样判断山体遮挡；复用向量，不遍历场景三角形。 */
export function createMoonViewVisibility(heightAt) {
  const center=new Vector3(),right=new Vector3(),up=new Vector3(),point=new Vector3(),projected=new Vector3(),direction=new Vector3();
  const offsets=[[0,0],[-.6,0],[.6,0],[0,-.6],[0,.6]];
  function terrainBlocks(origin, target) {
    if(typeof heightAt!=='function')return false;
    direction.subVectors(target,origin);const length=direction.length();direction.divideScalar(length);
    let entry=0,exit=length;
    for(const [axis,low,high]of [['x',-155,155],['y',-10,120],['z',-155,155]]) {
      const d=direction[axis],o=origin[axis];
      if(Math.abs(d)<1e-8){if(o<low||o>high)return false;continue;}
      const a=(low-o)/d,b=(high-o)/d;entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
      if(exit<entry)return false;
    }
    const steps=Math.max(1,Math.ceil((exit-entry)/2));
    for(let i=0;i<=steps;i++) {
      const distance=entry+(exit-entry)*i/steps;
      const x=origin.x+direction.x*distance,z=origin.z+direction.z*distance,y=origin.y+direction.y*distance;
      const ground=heightAt(x,z);
      if(Number.isFinite(ground)&&y<ground+.12)return true;
    }
    return false;
  }
  return (camera,moon)=>{
    if(!camera||!moon?.visible)return false;
    moon.getWorldPosition(center);
    right.setFromMatrixColumn(camera.matrixWorld,0);up.setFromMatrixColumn(camera.matrixWorld,1);
    const radius=Math.abs(moon.scale.x)*.5;
    for(const [x,y]of offsets) {
      point.copy(center).addScaledVector(right,x*radius).addScaledVector(up,y*radius);projected.copy(point).project(camera);
      if(![projected.x,projected.y,projected.z].every(Number.isFinite)||Math.abs(projected.x)>1||Math.abs(projected.y)>1||projected.z< -1||projected.z>1)continue;
      if(!terrainBlocks(camera.position,point))return true;
    }
    return false;
  };
}
