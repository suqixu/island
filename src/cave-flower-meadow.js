import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from './terrain.js';
import { caveToWorld } from './cave-layout.js';
import { createVegetationWindState, advanceVegetationWind, configureVegetationWindShader } from './vegetation-motion.js';

const palette = [0xff4869, 0xffa31a, 0xffd53c, 0xfff4d8, 0xdb62e4, 0x936bff, 0x5589f7, 0xf97fc3, 0xf05436, 0xeab9ff];

function flowerGeometry(petals) {
  const parts = [];
  if (petals) {
    // Curved petals have a raised rim and a central fold, rather than flat discs.
    const positions=[],indices=[];
    for(let petal=0;petal<6;petal++) {
      const angle=petal*Math.PI/3, start=positions.length/3;
      for(const [radius,offset,y] of [[.018,0,.52],[.11,-.075,.535],[.22,-.043,.59],[.24,0,.61],[.22,.043,.59],[.11,.075,.535],[.12,0,.57]]) {
        positions.push(Math.sin(angle)*radius+Math.cos(angle)*offset,y,Math.cos(angle)*radius-Math.sin(angle)*offset);
      }
      for(let i=0;i<6;i++)indices.push(start+6,start+i,start+(i+1)%6);
    }
    const petalsGeometry=new THREE.BufferGeometry();
    petalsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));petalsGeometry.setIndex(indices);
    petalsGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));
    petalsGeometry.computeVertexNormals();parts.push(petalsGeometry);
    const heart=new THREE.SphereGeometry(.041,7,4);heart.scale(1,.55,1);heart.translate(0,.545,0);parts.push(heart);
  } else {
    const stem=new THREE.CylinderGeometry(.006,.011,.52,5);stem.translate(0,.26,0);parts.push(stem);
    for(const [y,angle] of [[.19,.2],[.32,3.6]]) {
      const leaf=new THREE.SphereGeometry(1,7,4);leaf.scale(.05,.014,.13);leaf.rotateX(-.35);leaf.translate(0,y,.08);leaf.rotateY(angle);parts.push(leaf);
    }
  }
  const geometry=mergeGeometries(parts);parts.forEach(part=>part.dispose());
  const p=geometry.attributes.position;
  geometry.setAttribute('aFlex',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>Math.min(1,Math.max(0,p.getY(i)/.62))),1));
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.35;
  return geometry;
}

/** Dense, unequal colonies flank the entrance. Only two draw calls; wind runs on the GPU. */
export function createCaveFlowerMeadow(parent,{heightAt,distanceAt}={}) {
  const group=new THREE.Group();group.name='山洞前繁花';group.userData.caveFlowerMeadow=true;parent.add(group);
  const random=seededRandom(72931),spots=[];
  const colonies=[[-4.6,3.1],[-6,6],[-8,8.5],[4.4,3.5],[6.4,6.7],[8.4,9.5]];
  for(let i=0;i<1100;i++) {
    const [side,forward]=colonies[i%colonies.length],angle=random()*Math.PI*2,radius=Math.sqrt(random());
    const point=caveToWorld(side+Math.cos(angle)*radius*2.1,0,forward+Math.sin(angle)*radius*2.3);
    const y=heightAt?.(point.x,point.z);
    if(!Number.isFinite(y)||forward+Math.sin(angle)*radius*2.3<1.8||(distanceAt?.(point.x,point.z)??2)<.6)continue;
    const slope=Math.max(Math.abs(heightAt(point.x+.2,point.z)-y),Math.abs(heightAt(point.x,point.z+.2)-y));
    if(!Number.isFinite(slope)||slope>.38)continue;
    spots.push({x:point.x,y:y+.006,z:point.z,scale:.70+random()*.95,angle:random()*Math.PI*2,tone:Math.floor(random()*palette.length)});
  }
  const uniforms={uTime:{value:0},uWindDirection:{value:new THREE.Vector2()},uPlantAmplitudes:{value:new THREE.Vector3()},uLeafFlutter:{value:0}};
  const compile=shader=>configureVegetationWindShader(shader,uniforms,'road');
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  depth.onBeforeCompile=compile;depth.customProgramCacheKey=()=> 'cave-flowers-depth-v1';
  const materials=[new THREE.MeshStandardMaterial({color:0x4b8129,roughness:.94,side:THREE.DoubleSide}),
    new THREE.MeshStandardMaterial({color:0xffffff,roughness:.72,side:THREE.DoubleSide})];
  materials.forEach(material=>{material.onBeforeCompile=compile;material.customProgramCacheKey=()=> 'cave-flowers-v1';});
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const meshes=materials.map((material,index)=>{
    const mesh=new THREE.InstancedMesh(flowerGeometry(index===1),material,spots.length);
    mesh.name=index?'洞前缤纷花瓣':'洞前花茎与叶';mesh.userData.caveFlowerMeadow=true;
    mesh.customDepthMaterial=depth;mesh.castShadow=false;mesh.receiveShadow=true;
    spots.forEach((spot,i)=>{
      dummy.position.set(spot.x,spot.y,spot.z);dummy.rotation.set(0,spot.angle,0);dummy.scale.setScalar(spot.scale);dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);if(index)mesh.setColorAt(i,color.setHex(palette[spot.tone]));
    });
    mesh.computeBoundingSphere();mesh.boundingSphere.radius+=.5;group.add(mesh);return mesh;
  });
  const wind=createVegetationWindState();let disposed=false;
  return {group,count:spots.length,
    update(time,env={}) {
      if(disposed)return;advanceVegetationWind(wind,time,env);
      uniforms.uTime.value=wind.time;uniforms.uWindDirection.value.fromArray(wind.direction);
      uniforms.uPlantAmplitudes.value.fromArray(wind.amplitudes).multiplyScalar(.40);uniforms.uLeafFlutter.value=wind.flutter*.18;
      const visible=env.season!=='winter'&&env.seasonIndex!==3&&(env.snow??0)<.5;
      meshes.forEach(mesh=>{mesh.visible=visible;});
    },
    dispose() {
      if(disposed)return;disposed=true;
      meshes.forEach(mesh=>{mesh.dispose();mesh.geometry.dispose();});materials.forEach(material=>material.dispose());depth.dispose();group.removeFromParent();
    },
  };
}
