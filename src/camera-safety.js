/** Keep orbit/pan/zoom cameras above visible ground, including the near plane. */
export function createCameraSafety(camera,controls,{heightAt,waterHeightAt,interiorFloorAt,clearance=1.25}={}) {
  const offsets=[[0,0],[.75,0],[-.75,0],[0,.75],[0,-.75]];
  function update() {
    let changed=false;
    if(controls.target.y<0) {
      camera.position.y-=controls.target.y;controls.target.y=0;changed=true;
    }
    const eye=camera.position,interior=interiorFloorAt?.(eye);
    let floor=2;
    if(Number.isFinite(interior))floor=Math.max(floor,interior+clearance);
    else for(const [dx,dz] of offsets) {
      const ground=heightAt?.(eye.x+dx,eye.z+dz);
      if(Number.isFinite(ground))floor=Math.max(floor,ground+clearance);
    }
    // Even fully developed wind seas + surge stay below 30m. Skip expensive
    // local water sampling while an eye/terrain floor is safely above them.
    if(!Number.isFinite(interior)&&eye.y<32&&floor<32) {
      const water=waterHeightAt?.(eye.x,eye.z);
      if(Number.isFinite(water))floor=Math.max(floor,water+clearance);
    }
    if(eye.y<floor){eye.y=floor;changed=true;}
    if(changed){camera.lookAt(controls.target);camera.updateMatrixWorld();}
    return changed;
  }
  return {update};
}
