import * as THREE from 'three';
import {ZODIAC_CONSTELLATIONS} from './zodiac-constellations.js';

// HR identifiers from the same CDS V/50 catalogue as the visible stars.
// These are familiar illustrative stick figures, not IAU boundary polygons.
const shapes=[
  {name:'北斗七星',paths:[[4301,4295,4554,4660,4301],[4660,4905,5054,5191]]},
  {name:'仙后座',paths:[[21,168,264,403,542]]},
  {name:'猎户座',paths:[[2061,1790,1852,1713,2004,1948,2061],[1852,1903,1948]]},
  {name:'天鹅座',paths:[[7924,7796,7417],[7528,7796,7949,8115]]},
  {name:'天琴座',paths:[[7001,7056,7139,7178,7106,7056],[7001,7106]]},
  ...ZODIAC_CONSTELLATIONS,
];
function position(ra,dec){const a=ra*Math.PI/180,d=dec*Math.PI/180;return new THREE.Vector3(Math.cos(d)*Math.cos(a),Math.sin(d),Math.cos(d)*Math.sin(a)).multiplyScalar(2180);}
export function createConstellationGuides(catalogue){
  const group=new THREE.Group();group.name='constellation-guides';group.visible=false;
  const stars=new Map(catalogue.map(([id,ra,dec])=>[id,position(ra,dec)]));
  const opacity={value:0},material=new THREE.ShaderMaterial({
    uniforms:{uOpacity:opacity,uColor:{value:new THREE.Color(1,1,1)}},transparent:true,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending,
    vertexShader:/* glsl */`varying float vAltitude;void main(){vAltitude=normalize(mat3(modelMatrix)*position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:/* glsl */`uniform float uOpacity;uniform vec3 uColor;varying float vAltitude;void main(){gl_FragColor=vec4(uColor,uOpacity*smoothstep(.01,.09,vAltitude));}`,
  });
  const anchors=[],connected=new Set();
  for(const shape of shapes){
    const vertices=[],ids=new Set(),center=new THREE.Vector3();
    for(const path of shape.paths)for(let i=1;i<path.length;i++){
      const a=stars.get(path[i-1]),b=stars.get(path[i]);if(!a||!b)continue;
      vertices.push(a.x,a.y,a.z,b.x,b.y,b.z);ids.add(path[i-1]);ids.add(path[i]);
    }
    for(const id of ids){center.add(stars.get(id));connected.add(id);}
    center.normalize().multiplyScalar(2180);center.y+=80;center.normalize().multiplyScalar(2180);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const lines=new THREE.LineSegments(geometry,material);lines.name=shape.name;lines.frustumCulled=false;lines.renderOrder=-900;group.add(lines);
    anchors.push({name:shape.name,position:center,label:null});
  }
  const nodePositions=[];
  for(const id of connected)nodePositions.push(...stars.get(id).toArray());
  const nodeGeometry=new THREE.BufferGeometry();nodeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(nodePositions,3));
  const nodeMaterial=new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0},uPixelRatio:{value:1}},transparent:true,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending,
    vertexShader:/* glsl */`uniform float uPixelRatio;varying float vAltitude;void main(){vAltitude=normalize(mat3(modelMatrix)*position).y;gl_PointSize=8.0*uPixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:/* glsl */`uniform float uOpacity;varying float vAltitude;void main(){float r=length(gl_PointCoord-.5)*2.0;float core=exp(-r*r*13.0),halo=exp(-r*r*3.5)*.22;gl_FragColor=vec4(.96,.98,1.0,(core+halo)*uOpacity*(1.0-smoothstep(.65,1.0,r))*smoothstep(.01,.12,vAltitude));}`,
  });
  const nodes=new THREE.Points(nodeGeometry,nodeMaterial);nodes.name='constellation-nodes';nodes.frustumCulled=false;nodes.renderOrder=-895;group.add(nodes);
  let enabled=false,labelsEnabled=false,disposed=false;
  function makeLabels(){
    if(typeof document==='undefined')return;
    for(const anchor of anchors){
      if(anchor.label)continue;
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=80;
      const paint=canvas.getContext('2d');if(!paint)continue;
      paint.font='500 40px system-ui, sans-serif';paint.textAlign='center';paint.textBaseline='middle';
      paint.lineWidth=7;paint.strokeStyle='rgba(3,10,20,.9)';paint.strokeText(anchor.name,128,40);paint.fillStyle='#ffe0a1';paint.fillText(anchor.name,128,40);
      const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
      const label=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,toneMapped:false,fog:false}));
      label.name=`${anchor.name}名称`;label.position.copy(anchor.position);label.scale.set(330,103,1);label.renderOrder=-890;label.frustumCulled=false;
      anchor.label=label;group.add(label);
    }
  }
  function setMode(value){
    enabled=value==='lines'||value==='labels';labelsEnabled=value==='labels';group.visible=enabled;
    if(labelsEnabled)makeLabels();
    for(const anchor of anchors)if(anchor.label)anchor.label.visible=enabled&&labelsEnabled;
  }
  function setVisible(value){setMode(value?'labels':'off');}
  const direction=new THREE.Vector3();
  function update(visibility,rotation,pixelRatio=1){
    group.visible=enabled&&visibility>.01;opacity.value=visibility*.72;
    nodeMaterial.uniforms.uOpacity.value=visibility*1.3;nodeMaterial.uniforms.uPixelRatio.value=pixelRatio;
    for(const anchor of anchors)if(anchor.label){
      direction.copy(anchor.position).applyQuaternion(rotation).normalize();
      anchor.label.visible=enabled&&labelsEnabled&&direction.y>.02;anchor.label.material.opacity=visibility*THREE.MathUtils.smoothstep(direction.y,.02,.12)*.9;
    }
  }
  function dispose(){
    if(disposed)return;disposed=true;material.dispose();nodeMaterial.dispose();
    group.traverse(object=>{object.geometry?.dispose();if(object.isSprite){object.material.map.dispose();object.material.dispose();}});
    group.removeFromParent();group.clear();
  }
  return{group,setVisible,setMode,update,dispose};
}
