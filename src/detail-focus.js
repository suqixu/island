import * as THREE from 'three';

/** Pick existing visible geometry only on a gesture, never during animation. */
export function createDetailFocus({element,camera,roots,onFocus,water}) {
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),meshes=[];
  const touches=new Map();
  let lastTap=null,touchFocusAt=-Infinity,disposed=false;
  function focus(clientX,clientY){
    if(disposed)return;
    const rect=element.getBoundingClientRect();
    if(!rect.width||!rect.height||clientX<rect.left||clientX>rect.left+rect.width||clientY<rect.top||clientY>rect.top+rect.height)return;
    pointer.set((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2);
    camera.updateWorldMatrix(true,false);meshes.length=0;
    for(const root of roots){
      root.updateWorldMatrix(true,true);
      root.traverseVisible(object=>{
        if(!object.isMesh)return;
        for(let parent=object;parent;parent=parent.parent)if(parent.name.startsWith('海鸟-'))return;
        meshes.push(object);
      });
    }
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(meshes,false).find(hit=>
      hit.point.toArray().every(Number.isFinite)&&
      (hit.object!==water||Math.hypot(hit.point.x,hit.point.z)<=420));
    if(!hit)return;
    const target=hit.point.clone(),direction=camera.position.clone().sub(target);
    const distance=THREE.MathUtils.clamp(direction.length()*.28,3.5,12);
    if(direction.lengthSq()<.000001)direction.set(1,.5,1);
    direction.normalize();direction.y=Math.max(.18,direction.y);direction.normalize();
    onFocus({target,position:target.clone().addScaledVector(direction,distance)});
  }
  function doubleClick(event){
    if(event.timeStamp-touchFocusAt>=0&&event.timeStamp-touchFocusAt<500)return;
    focus(event.clientX,event.clientY);
  }
  function down(event){
    if(event.pointerType!=='touch')return;
    const multi=touches.size>0;
    if(multi){for(const touch of touches.values())touch.moved=true;lastTap=null;}
    touches.set(event.pointerId,{x:event.clientX,y:event.clientY,time:event.timeStamp,moved:multi});
  }
  function move(event){
    const touch=touches.get(event.pointerId);
    if(touch&&Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>10){touch.moved=true;lastTap=null;}
  }
  function up(event){
    const touch=touches.get(event.pointerId);touches.delete(event.pointerId);
    if(!touch)return;
    if(touch.moved||touches.size||event.timeStamp-touch.time>350||Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>10){lastTap=null;return;}
    if(lastTap&&event.timeStamp-lastTap.time<300&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<22){
      lastTap=null;touchFocusAt=event.timeStamp;focus(event.clientX,event.clientY);
    }else lastTap={x:event.clientX,y:event.clientY,time:event.timeStamp};
  }
  function cancel(event){touches.delete(event.pointerId);lastTap=null;}
  const listeners={dblclick:doubleClick,pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel};
  for(const [type,listener] of Object.entries(listeners))element.addEventListener(type,listener);
  return {dispose(){
    if(disposed)return;disposed=true;
    for(const [type,listener] of Object.entries(listeners))element.removeEventListener(type,listener);
    touches.clear();meshes.length=0;lastTap=null;
  }};
}
