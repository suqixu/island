import {isSnowLandscape} from '../snow-surface.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from '../terrain.js';
import { caveToWorld } from '../cave-layout.js';
import { createVegetationWindState, advanceVegetationWind, configureVegetationWindShader } from '../vegetation-motion.js';
import { createFlowerAnchors } from '../flower-anchors.js';
import butterflyConfig from '../config/butterflies.json' with { type: 'json' };
import renderingConfig from '../config/rendering.json' with { type: 'json' };
import {markPetalTexture,attachFlowerTexture} from '../flower-texture.js';
import {attachLeafTexture} from '../leaf-texture.js';

const palette = [0xff2b16,0xff6b00,0xffc400,0x70bc2c,0x00b9ca,0x145bea,0x7a26e6,0xfff4d4,0xff4793,0xb85cff];
const centers=[0xffe39c,0xfff7ed,0xffbed3,0xff878a];
const colonyTones=[[0,1,2,8],[1,2,7],[0,1,2],[2,7,8],[0,1,6,8],[1,2,8,9]];

function flowerGeometry(petals,far=false) {
  const parts = [];
  if (petals) {
    // 各瓣用独立球心、倾角和着生高度，宽圆曲面只轻搭相邻花瓣。
    const positions=[],indices=[],uvs=[],colors=[],normals=[];
    const rows=far?[0,1]:[0,.35,.70,1],columns=far?[-1,0,1]:[-1,-.5,0,.5,1];
    const layers=[{count:7,radius:.25,arc:.78,spread:.50,y:.530},{count:6,radius:.17,arc:.94,spread:.54,y:.538},{count:5,radius:.10,arc:1.15,spread:.60,y:.560}];
    layers.forEach((layer,ring)=>{for(let petal=0;petal<layer.count;petal++){
      const phase=petal*2.399+ring*1.7,angle=(petal+ring*.47)*Math.PI*2/layer.count+.035*Math.sin(phase),start=positions.length/3;
      const variation=.11*Math.sin(phase),curvatureRadius=layer.radius*(1+variation);
      const mount=ring===2?.004+.003*Math.sin(phase*1.3):.022+.007*Math.sin(phase*1.3),side=.005*Math.cos(phase*1.7);
      const height=layer.y+.006*Math.sin(phase+.6),lean=.055*Math.sin(phase+.9),twist=.025*Math.cos(phase);
      rows.forEach(t=>{for(const u of columns){
        // 圆弧端部与单调曲面参数保留圆瓣轮廓，不以折缘制造轮廓。
        const theta=.10+t*layer.arc*(1-.20*u*u)*(1+variation*.45),phi=u*layer.spread;
        const radius=curvatureRadius*Math.sin(theta),x=Math.sin(phi)*radius,z=Math.cos(phi)*radius;
        const y=height+curvatureRadius*(1-Math.cos(theta))+lean*z+twist*x;
        positions.push(Math.cos(angle)*(x+side)+Math.sin(angle)*(z+mount),y,-Math.sin(angle)*(x+side)+Math.cos(angle)*(z+mount));
        const ny=Math.cos(theta),nx=-Math.sin(phi)*Math.sin(theta)-twist*ny,nz=-Math.cos(phi)*Math.sin(theta)-lean*ny;
        const length=Math.hypot(nx,ny,nz);
        normals.push((Math.cos(angle)*nx+Math.sin(angle)*nz)/length,ny/length,(-Math.sin(angle)*nx+Math.cos(angle)*nz)/length);
        uvs.push(.5+u*.48,t);
        const shade=(.91+.065*t+.035*Math.sin(phase+1.2))*(.96+.04*(1-u*u));colors.push(shade,shade,shade);
      }});
      for(let row=0;row<rows.length-1;row++)for(let column=0;column<columns.length-1;column++){
        const a=start+row*columns.length+column,b=a+columns.length;indices.push(a,b,a+1,a+1,b,b+1);
      }
    }});
    const petalsGeometry=new THREE.BufferGeometry();
    petalsGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));petalsGeometry.setIndex(indices);
    petalsGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    petalsGeometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    petalsGeometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    markPetalTexture(petalsGeometry,true);parts.push(petalsGeometry);
    const addHeartPart=(geometry,shade)=>{
      markPetalTexture(geometry,false);
      if(!geometry.index)geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,i)=>i));
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*3).fill(shade),3));
      parts.push(geometry);
    };
    // 紧密错落的短花粉簇直接长在瓣口，避免均匀直花丝像一束硬棒。
    // 远景保留全部18瓣与同一渐变UV，只减少曲面采样；花粉簇合成一个同高花心。
    const heart=new THREE.SphereGeometry(far?.036:.033,far?4:8,2);heart.scale(1,far?.5:.24,1);heart.translate(0,far?.637:.621,0);addHeartPart(heart,far?.9:.72);
    for(let grain=0;grain<(far?0:14);grain++){
      const angle=grain*2.399,reach=grain===0?0:.009*Math.sqrt(grain);
      const top=new THREE.Vector3(Math.sin(angle)*reach,grain===0?.646:.631+.004*Math.sin(grain*1.7)+.004*(1-reach/.034),Math.cos(angle)*reach);
      const anther=new THREE.SphereGeometry(.0085,4,2);anther.scale(.82,1.05+.15*Math.sin(grain*2.1),.78);anther.rotateY(angle);anther.translate(top.x,top.y,top.z);
      const values=[];
      for(let i=0;i<anther.attributes.position.count;i++){
        const shade=.82+.15*Math.max(0,anther.attributes.normal.getY(i))+.025*Math.sin(grain*1.7);values.push(shade,shade,shade);
      }
      addHeartPart(anther,1);anther.setAttribute('color',new THREE.Float32BufferAttribute(values,3));
    }
  } else {
    const stem=new THREE.CylinderGeometry(.006,.011,.52,far?3:5);stem.setAttribute('aLeafTexture',new THREE.Float32BufferAttribute(new Float32Array(stem.attributes.position.count),1));stem.translate(0,.26,0);parts.push(stem);
    for(const [y,angle] of [[.19,.2],[.32,3.6]]) {
      const leaf=far?new THREE.PlaneGeometry(.1,.26):new THREE.SphereGeometry(1,7,4);if(far)leaf.rotateX(-Math.PI/2);else leaf.scale(.05,.014,.13);const p=leaf.attributes.position,uv=leaf.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/.1+.5,p.getZ(i)/.26+.5);leaf.setAttribute('aLeafTexture',new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(1),1));leaf.rotateX(-.35);leaf.translate(0,y,.08);leaf.rotateY(angle);parts.push(leaf);
    }
  }
  const geometry=mergeGeometries(parts);parts.forEach(part=>part.dispose());
  const p=geometry.attributes.position;
  geometry.setAttribute('aFlex',new THREE.Float32BufferAttribute(Array.from({length:p.count},(_,i)=>Math.min(1,Math.max(0,p.getY(i)/.62))),1));
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=.35;
  return geometry;
}

/** 六个固定花簇按距离切换几何，实例变换始终不变；近远景共用GPU风摆与纹理。 */
export function createCaveFlowerMeadow(parent,{heightAt,distanceAt,flowerTexture,leafTexture}={}) {
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
    const tones=colonyTones[i%colonies.length],choice=random(),tone=choice<.88?tones[Math.floor(random()*tones.length)]:Math.floor(random()*palette.length);
    spots.push({colony:i%colonies.length,x:point.x,y:y+.006,z:point.z,scale:.72+random()*.80,width:.72+random()*.45,angle:random()*Math.PI*2,tiltX:(random()-.5)*.26,tiltZ:(random()-.5)*.26,tone});
  }
  const uniforms={uTime:{value:0},uWindDirection:{value:new THREE.Vector2()},uPlantAmplitudes:{value:new THREE.Vector3()},uLeafFlutter:{value:0}};
  const compile=shader=>configureVegetationWindShader(shader,uniforms,'road');
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});
  depth.onBeforeCompile=compile;depth.customProgramCacheKey=()=> 'cave-flowers-depth-v1';
  const materials=[new THREE.MeshStandardMaterial({color:0x4b8129,roughness:.94,side:THREE.DoubleSide}),
    new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.72,side:THREE.DoubleSide})];
  materials.forEach(material=>{material.onBeforeCompile=compile;material.customProgramCacheKey=()=> 'cave-flowers-v1';});
  attachFlowerTexture(materials[1],flowerTexture,{centerColors:true});attachLeafTexture(materials[0],leafTexture,{mixed:true,snow:'0.0'});
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  const geometries=[false,true].map(far=>[flowerGeometry(false,far),flowerGeometry(true,far)]);
  const clusters=[],meshes=[];
  for(let colony=0;colony<colonies.length;colony++) {
    const plants=spots.filter(spot=>spot.colony===colony);
    if(!plants.length)continue;
    const levels=geometries.map((templates,level)=>materials.map((material,index)=>{
      // 花瓣的花心色为每簇独立实例属性；茎叶几何可跨全部花簇共享。
      const geometry=index?templates[index].clone():templates[index];
      const mesh=new THREE.InstancedMesh(geometry,material,plants.length);
      const name=index?'洞前缤纷花瓣':'洞前花茎与叶';
      mesh.name=`${name}${level?'远景':''}${colony?`-${colony}`:''}`;
      mesh.userData.caveFlowerMeadow=true;mesh.userData.flowerLod=level?'far':'near';
      if(index){const values=new Float32Array(plants.length*3);plants.forEach((spot,i)=>new THREE.Color(centers[spot.tone%centers.length]).toArray(values,i*3));geometry.setAttribute('aFlowerCenter',new THREE.InstancedBufferAttribute(values,3));}
      mesh.customDepthMaterial=depth;mesh.castShadow=false;mesh.receiveShadow=true;mesh.visible=!level;
      plants.forEach((spot,i)=>{
        dummy.position.set(spot.x,spot.y,spot.z);dummy.rotation.set(spot.tiltX,spot.angle,spot.tiltZ);dummy.scale.set(spot.width,spot.scale,spot.width);dummy.updateMatrix();
        mesh.setMatrixAt(i,dummy.matrix);if(index)mesh.setColorAt(i,color.setHex(palette[spot.tone]));
      });
      mesh.computeBoundingSphere();mesh.boundingSphere.radius+=.5;group.add(mesh);meshes.push(mesh);return mesh;
    }));
    const bounds=levels[0][1].boundingSphere.clone();
    const cluster={levels,bounds,far:false};clusters.push(cluster);
    plants.forEach((spot,index)=>{spot.cluster=cluster;spot.instance=index;});
  }
  // 模板自身也由本模块释放；近景花瓣用于花药高度查询，空花海同样有效。
  const petalGeometry=geometries[0][1],centerPoint=new THREE.Vector3(0,-Infinity,0);
  // 从实际花药顶点取得停栖点，花蕊形状改变时无需再维护高度常数。
  for(let i=0;i<petalGeometry.attributes.position.count;i++){
    if(petalGeometry.attributes.aPetalTexture.getX(i)<.5&&petalGeometry.attributes.position.getY(i)>centerPoint.y)centerPoint.fromBufferAttribute(petalGeometry.attributes.position,i);
  }
  const wind=createVegetationWindState(),cameraPoint=new THREE.Vector3(),worldBounds=new THREE.Sphere();
  const {nearDistance,farDistance}=renderingConfig.caveFlowerLod;
  let disposed=false;
  // 虚拟实例视图保留原来的全局种植顺序，只转发到固定花簇；无需额外GPU实例。
  const anchorInstances={count:spots.length,
    getMatrixAt(index,target) {const spot=spots[index];spot.cluster.levels[0][1].getMatrixAt(spot.instance,target);},
    updateWorldMatrix() {group.updateWorldMatrix(true,false);},
    get matrixWorld() {return group.matrixWorld;},
  };
  const observationMatrix=new THREE.Matrix4(),observationPoint=new THREE.Vector3(0,.568,0);
  return {group,count:spots.length,
    getObservationPoint(index,target,localPoint=observationPoint) {
      if(disposed||!Number.isInteger(index)||index<0||index>=spots.length)return null;
      const spot=spots[index],mesh=spot.cluster.levels[0][1];
      mesh.getMatrixAt(spot.instance,observationMatrix);mesh.updateWorldMatrix(true,false);
      return target.copy(localPoint).applyMatrix4(observationMatrix).applyMatrix4(mesh.matrixWorld);
    },
    getFlowerAnchors: () => {
      // 采样完整近景花药和固定矩阵，LOD不改变停栖花株、花心高度或风摆相位。
      const anchors=createFlowerAnchors(anchorInstances,uniforms,{
        point:centerPoint,flex:Math.min(1,centerPoint.y/.62),limit:butterflyConfig.anchorsPerMeadow,
      });
      return anchors.map((anchor,slot)=>{
        const {levels}=spots[Math.floor(slot*spots.length/anchors.length)].cluster;
        return {...anchor,available:()=>!disposed&&group.visible&&!!group.parent
          &&(levels[0][1].visible||levels[1][1].visible)};
      });
    },
    update(time,env={},camera) {
      if(disposed)return;advanceVegetationWind(wind,time,env);
      uniforms.uTime.value=wind.time;uniforms.uWindDirection.value.fromArray(wind.direction);
      uniforms.uPlantAmplitudes.value.fromArray(wind.amplitudes).multiplyScalar(.40);uniforms.uLeafFlutter.value=wind.flutter*.18;
      const visible=env.season!=='winter'&&env.seasonIndex!==3&&!isSnowLandscape(env);
      if(visible&&camera) {
        // 只检查六个包围球；相机和父组可能有额外变换，必须使用世界坐标。
        camera.getWorldPosition(cameraPoint);group.updateWorldMatrix(true,false);
      }
      for(const cluster of clusters) {
        if(visible) {
          if(camera) {
            worldBounds.copy(cluster.bounds).applyMatrix4(group.matrixWorld);
            const distance=Math.max(0,cameraPoint.distanceTo(worldBounds.center)-worldBounds.radius);
            if(distance>farDistance)cluster.far=true;
            else if(distance<nearDistance)cluster.far=false;
          } else cluster.far=false;
        }
        for(let index=0;index<cluster.levels.length;index++) {
          for(const mesh of cluster.levels[index])mesh.visible=visible&&((index===1)===cluster.far);
        }
      }
    },
    dispose() {
      if(disposed)return;disposed=true;
      const geometryResources=new Set(geometries.flat());
      meshes.forEach(mesh=>{mesh.dispose();geometryResources.add(mesh.geometry);});
      geometryResources.forEach(geometry=>geometry.dispose());
      materials.forEach(material=>material.dispose());depth.dispose();group.removeFromParent();
    },
  };
}
