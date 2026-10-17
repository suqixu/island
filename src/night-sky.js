import * as THREE from 'three';
import catalogue from './assets/data/bright-stars.json' with {type:'json'};
import {getAnimationRate} from './animation-time.js';
import {createMeteorShower} from './meteor-shower.js';
import {createConstellationGuides} from './constellation-guides.js';
import {COMET_STYLES} from './comet-styles.js';

const TAU=Math.PI*2, radians=THREE.MathUtils.degToRad, clamp=THREE.MathUtils.clamp;
const smooth=THREE.MathUtils.smoothstep;
function randomSource(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function direction(ra,dec,target=new THREE.Vector3()){
  const a=radians(ra),d=radians(dec);
  return target.set(Math.cos(d)*Math.cos(a),Math.sin(d),Math.cos(d)*Math.sin(a));
}
const pole=direction(192.85948,27.12825);
const galacticCenter=direction(266.4051,-28.936175);

const pointVertex=/* glsl */`
  attribute float aBrightness;
  attribute float aTwinkle;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vBrightness;
  varying vec3 vColor;
  varying vec3 vDirection;
  void main(){
    vDirection=normalize(mat3(modelMatrix)*position);
    float wave=sin(uTime*(.65+fract(aPhase)*1.3)+aPhase)*.6
      +sin(uTime*(1.13+fract(aPhase*2.7)) +aPhase*1.73)*.4;
    float scintillation=1.0+aTwinkle*wave*(1.0-clamp(vDirection.y,0.0,1.0)*.5);
    float twinkleBoost=aTwinkle>0.0?1.35:1.0;
    vBrightness=aBrightness*twinkleBoost*scintillation;
    vColor=aColor;
    gl_PointSize=(1.15+3.0*aBrightness)*uPixelRatio;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;
const pointFragment=/* glsl */`
  uniform float uOpacity;
  uniform float uMoonWash;
  uniform vec3 uMoonDirection;
  varying float vBrightness;
  varying vec3 vColor;
  varying vec3 vDirection;
  void main(){
    float radius=length(gl_PointCoord-.5)*2.0;
    float core=exp(-radius*radius*3.5)*(1.0-smoothstep(.6,1.0,radius));
    float horizon=smoothstep(.012,.16,vDirection.y);
    float moon=1.0-uMoonWash*(.25+.65*pow(max(dot(vDirection,uMoonDirection),0.0),18.0))*(1.0-vBrightness*.6);
    gl_FragColor=vec4(vColor,core*vBrightness*uOpacity*horizon*moon);
  }
`;
const sphereVertex=/* glsl */`
  varying vec3 vDirection;
  varying vec3 vWorldDirection;
  void main(){
    vDirection=normalize(position);
    vWorldDirection=normalize(mat3(modelMatrix)*position);
    gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  }
`;
const bandFragment=/* glsl */`
  uniform float uOpacity;
  uniform float uDetail;
  uniform vec3 uPole;
  uniform vec3 uCenter;
  varying vec3 vDirection;
  varying vec3 vWorldDirection;
  float square(float x){return x*x;}
  float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  void main(){
    vec3 d=normalize(vDirection);
    float latitude=dot(d,uPole);
    float core=pow(max(dot(d,uCenter),0.0),3.0);
    float wisps=noise(d*18.0)*.55+noise(d*43.0+7.0)*.28+noise(d*99.0)*.17;
    float grain=mix(.5,noise(d*235.0),uDetail);
    float width=.062+core*.06+wisps*.022;
    float broad=exp(-square(latitude/(width*2.25)))*.19;
    float band=exp(-square((latitude+(wisps-.5)*.045)/width));
    float rift=exp(-square((latitude+.012+(noise(d*17.0)-.5)*.08)/.026));
    float patches=smoothstep(.28,.70,noise(d*24.0+vec3(3.0,8.0,1.0)));
    float density=(broad+band*(.16+wisps*.84))*(1.0-rift*patches*(.48+core*.32));
    density*=.85+core*1.1;
    density*=.94+grain*.12;
    vec3 color=mix(vec3(.42,.49,.60),vec3(.68,.58,.44),core*.45);
    float horizon=smoothstep(.015,.22,normalize(vWorldDirection).y);
    gl_FragColor=vec4(color,density*uOpacity*horizon);
  }
`;
const tailVertex=/* glsl */`
  varying vec2 vUv;
  varying float vAltitude;
  void main(){vUv=uv;vAltitude=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const tailFragment=/* glsl */`
  uniform float uOpacity;
  uniform float uComet;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAltitude;
  uniform vec3 uDustColor;
  uniform vec3 uIonColor;
  uniform float uSpread;
  uniform float uCurve;
  uniform float uSplit;
  uniform float uIonStrength;
  float square(float x){return x*x;}
  void main(){
    float x=vUv.x,y=(vUv.y-.5)*2.0;
    float curl=x*(.028*sin(x*19.0-uTime*.10)+.014*sin(x*43.0+uTime*.07));
    float center=uCurve*x*x+curl;
    float dust=exp(-square((y-center)/((.055+.54*sqrt(x))*uSpread))*3.0);
    float core=exp(-square((y-center*.35)/(.035+.14*x))*2.0);
    float ionCenter=-(.035+uSplit)*x+.018*x*sin(x*45.0-uTime*.12);
    float ion=exp(-square((y-ionCenter)/(.016+.04*x))*2.0);
    float strands=.86+.14*sin(y/(.12+x)*28.0+x*8.0-uTime*.08+sin(x*25.0));
    float meteor=exp(-y*y*24.0)*pow(1.0-x,1.9);
    float envelope=exp(-x*1.4)*pow(1.0-x,1.15)*smoothstep(0.0,.008,x);
    float dusty=dust*strands*.68+core*.56,ionic=ion*uIonStrength;
    vec3 color=mix(vec3(.80,.88,1.0),(uDustColor*dusty+uIonColor*ionic)/max(dusty+ionic,.0001),uComet);
    float alpha=mix(meteor,(dusty+ionic)*envelope,uComet);
    gl_FragColor=vec4(color,alpha*uOpacity*smoothstep(.12,.24,vAltitude));
  }
`;

function points(positions,brightness,colors,twinkles,phases,uniforms,name){
  const geometry=new THREE.BufferGeometry();
  for(const [key,array,size]of [['position',positions,3],['aBrightness',brightness,1],['aColor',colors,3],['aTwinkle',twinkles,1],['aPhase',phases,1]])
    geometry.setAttribute(key,new THREE.Float32BufferAttribute(array,size));
  const material=new THREE.ShaderMaterial({uniforms,vertexShader:pointVertex,fragmentShader:pointFragment,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.Points(geometry,material);mesh.name=name;mesh.frustumCulled=false;mesh.renderOrder=-910;
  return mesh;
}
function tail(name,comet,time){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(12),3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,1,1,0,1,1],2));
  geometry.setIndex([0,2,1,2,3,1]);
  const material=new THREE.ShaderMaterial({uniforms:{uOpacity:{value:0},uComet:{value:comet?1:0},uTime:time,
    uDustColor:{value:new THREE.Color()},uIonColor:{value:new THREE.Color()},uSpread:{value:1},uCurve:{value:.055},uSplit:{value:0},uIonStrength:{value:.32},
  },vertexShader:tailVertex,fragmentShader:tailFragment,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.renderOrder=-860;mesh.frustumCulled=false;mesh.visible=false;
  return mesh;
}

/** Real relative J2000 star positions; a seasonal sky at a representative 30°N.
 * This is scenery, not a location/date based ephemeris. Events use unaccelerated
 * elapsed time, retain world directions, and allocate no geometry per frame.
 */
export function createNightSky({cometRandom=Math.random,meteorRandom=Math.random,eventRandom=Math.random}={}){
  const random=randomSource(731905),group=new THREE.Group(),celestial=new THREE.Group();
  group.name='night-sky';celestial.name='celestial-sphere';group.add(celestial);
  const guides=createConstellationGuides(catalogue);celestial.add(guides.group);
  const uniforms={uOpacity:{value:0},uTime:{value:0},uPixelRatio:{value:1},uMoonWash:{value:0},uMoonDirection:{value:new THREE.Vector3(0,1,0)}};
  const positions=[],brightness=[],colors=[],twinkles=[],phases=[];
  const vector=new THREE.Vector3();
  for(const [,ra,dec,magnitude,bv]of catalogue){
    direction(ra,dec,vector).multiplyScalar(2200);positions.push(vector.x,vector.y,vector.z);
    brightness.push(.22+.78*Math.exp(-Math.max(0,magnitude)*.38));
    const warm=clamp((bv-.15)/1.7,0,1),cool=clamp((.4-bv)/.8,0,1);
    colors.push(1-cool*.22, .94-warm*.14,1-warm*.42);
    twinkles.push(random()<.27?.10+random()*.12:0);phases.push(random()*100);
  }
  const stars=points(positions,brightness,colors,twinkles,phases,uniforms,'catalogue-stars');celestial.add(stars);
  const mistUniforms={...uniforms,uOpacity:{value:0}};
  const mistPos=[],mistBright=[],mistColor=[],mistTwinkle=[],mistPhase=[];
  const axis=new THREE.Vector3(0,1,0).cross(pole).normalize(),other=new THREE.Vector3().crossVectors(pole,axis).normalize();
  for(let i=0;i<4200;i++){
    const angle=random()*TAU,spread=(random()+random()+random()-1.5)*.13;
    vector.copy(axis).multiplyScalar(Math.cos(angle)).addScaledVector(other,Math.sin(angle)).addScaledVector(pole,spread).normalize().multiplyScalar(2240);
    mistPos.push(vector.x,vector.y,vector.z);mistBright.push(.07+random()*.12);mistColor.push(.78,.82,.92);mistTwinkle.push(0);mistPhase.push(0);
  }
  const mist=points(mistPos,mistBright,mistColor,mistTwinkle,mistPhase,mistUniforms,'galactic-faint-stars');celestial.add(mist);
  const band=new THREE.Mesh(new THREE.SphereGeometry(2320,40,28),new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0},uDetail:{value:1},uPole:{value:pole.clone()},uCenter:{value:galacticCenter.clone()}},
    vertexShader:sphereVertex,fragmentShader:bandFragment,side:THREE.BackSide,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
  }));
  band.name='milky-way';band.frustumCulled=false;band.renderOrder=-930;celestial.add(band);
  const shower=createMeteorShower({groupRandom:meteorRandom,timeRandom:eventRandom}),comet=tail('comet',true,uniforms.uTime);group.add(shower.group,comet);
  const headGeometry=new THREE.BufferGeometry();headGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(3),3).setUsage(THREE.DynamicDrawUsage));
  const head=new THREE.Points(headGeometry,new THREE.ShaderMaterial({
    uniforms:{uOpacity:{value:0},uPixelRatio:uniforms.uPixelRatio,uSize:{value:64},uColor:{value:new THREE.Color()}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
    vertexShader:/* glsl */`uniform float uPixelRatio;uniform float uSize;void main(){gl_PointSize=uSize*uPixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:/* glsl */`uniform float uOpacity;uniform vec3 uColor;void main(){float r=length(gl_PointCoord-.5)*2.0;float a=exp(-r*r*9.0)*.38+exp(-r*r*130.0);gl_FragColor=vec4(uColor,a*uOpacity*(1.0-smoothstep(.5,1.0,r)));}`,
  }));head.name='comet-head';head.visible=false;head.frustumCulled=false;head.renderOrder=-850;group.add(head);
  const rotation=new THREE.Matrix4(),heading=new THREE.Vector3(),cometStart=new THREE.Vector3(),cometEnd=new THREE.Vector3();
  const headPosition=new THREE.Vector3(),tailPosition=new THREE.Vector3(),side=new THREE.Vector3(),away=new THREE.Vector3(),sun=new THREE.Vector3(),pathUp=new THREE.Vector3();
  const cometTangent=new THREE.Vector3(),cometBounds=new THREE.Box3(),cometFrustum=new THREE.Frustum(),viewRotation=new THREE.Matrix4(),clipFromSky=new THREE.Matrix4();
  let disposed=false,quality='high',clock=0,lastTime,cometAt=15+eventRandom()*75;
  let cometAge=Infinity,cometSpeed=0,cometActive=false,cometMode='default',enteredView=false,outsideFor=0,cometStyle=COMET_STYLES[0];

  function finishComet(initial=false){
    cometActive=false;comet.visible=head.visible=false;
    comet.material.uniforms.uOpacity.value=head.material.uniforms.uOpacity.value=0;
    cometAt=clock+(cometMode==='instant'?0:initial?15+eventRandom()*75:40+eventRandom()*200);
  }

  function setCometMode(value){
    const next=['default','instant','off'].includes(value)?value:'default';
    if(next===cometMode)return;cometMode=next;finishComet(true);
  }
  function setCometsVisible(value){setCometMode(value?'default':'off');}

  function seedPath(view,target,finish,travel){
    view.getWorldDirection(heading);
    const azimuth=Math.atan2(heading.z,heading.x)+(random()-.5)*.18;
    const altitude=clamp(Math.asin(clamp(heading.y,-1,1))+.44+random()*.10,.82,1.12);
    target.set(Math.cos(azimuth)*Math.cos(altitude),Math.sin(altitude),Math.sin(azimuth)*Math.cos(altitude));
    side.set(-Math.sin(azimuth),0,Math.cos(azimuth));
    pathUp.crossVectors(side,target).normalize();if(pathUp.y<0)pathUp.negate();
    const bearing=cometStyle.bearing+(random()-.5)*.08;
    finish.copy(target).addScaledVector(side,travel*Math.cos(bearing)).addScaledVector(pathUp,travel*Math.sin(bearing)).normalize();
  }
  function quad(mesh,at,to,headWidth,tailWidth){
    side.crossVectors(at,to);if(side.lengthSq()<1e-10)side.set(0,1,0);side.normalize();
    const array=mesh.geometry.getAttribute('position');
    for(let i=0;i<4;i++){
      const point=i<2?at:to,width=i<2?headWidth:tailWidth,sign=i%2?1:-1;
      array.setXYZ(i,point.x+side.x*width*sign,point.y+side.y*width*sign,point.z+side.z*width*sign);
    }
    array.needsUpdate=true;
  }
  function update(time,env={},view){
    if(disposed||!view)return;
    const now=Number.isFinite(time)?time:(lastTime??0);
    const dt=lastTime===undefined?0:clamp((now-lastTime)/getAnimationRate(env),0,.25);lastTime=now;
    const night=1-smooth(clamp(env.daylight??1,0,1),.015,.30);
    const cover=clamp(Math.max(env.cloudiness??.12,(env.skyCloudCover??0)*.75),0,1);
    const visibility=night*(1-smooth(cover,.35,1))*(1-clamp(env.fog??0,0,1));
    group.visible=visibility>.005;group.position.copy(view.position);
    // Rotate the whole celestial sphere together; no camera-facing star map.
    const seasons={spring:0,summer:1,autumn:2,winter:3};
    const index=seasons[env.season]??clamp(env.seasonIndex??1,0,3),hour=Number.isFinite(env.hour)?env.hour:22;
    const lst=(hour-12+index*6)*Math.PI/12,s=Math.sin(lst),c=Math.cos(lst),lat=Math.PI/6;
    rotation.set(-s,0,c,0,Math.cos(lat)*c,Math.sin(lat),Math.cos(lat)*s,0,-Math.sin(lat)*c,Math.cos(lat),-Math.sin(lat)*s,0,0,0,0,1);
    celestial.quaternion.setFromRotationMatrix(rotation);
    const moon=clamp(env.moonLight??0,0,1);
    uniforms.uOpacity.value=visibility;uniforms.uMoonWash.value=moon;
    if(env.moonDirection?.isVector3)uniforms.uMoonDirection.value.copy(env.moonDirection);
    else if(Array.isArray(env.moon))uniforms.uMoonDirection.value.fromArray(env.moon).normalize();
    uniforms.uPixelRatio.value=Math.min(globalThis.devicePixelRatio||1,quality==='low'?1:1.7);
    guides.update(visibility,celestial.quaternion,uniforms.uPixelRatio.value);
    band.material.uniforms.uOpacity.value=visibility*.20*(1-moon*.65);
    mistUniforms.uOpacity.value=visibility*.64*(1-moon*.65);
    mist.visible=quality!=='low';
    // Only clear-night observing time advances event scheduling. Daytime doesn't
    // accumulate missed events or cause a burst when the sky becomes visible.
    if(visibility>.2&&cometMode!=='off')clock+=dt;
    uniforms.uTime.value+=dt;
    cometAge+=dt;
    shower.update(dt,visibility,view,{moonLight:moon,pixelRatio:uniforms.uPixelRatio.value});
    if(cometMode!=='off'&&!cometActive&&clock>=cometAt&&visibility>.2){
      cometActive=true;cometAge=0;enteredView=false;outsideFor=0;
      cometStyle=COMET_STYLES[clamp(Math.floor(cometRandom()*COMET_STYLES.length),0,COMET_STYLES.length-1)];
      comet.userData.variant=cometStyle.id;comet.userData.variantName=cometStyle.name;
      const u=comet.material.uniforms;
      u.uDustColor.value.fromArray(cometStyle.dustColor);u.uIonColor.value.fromArray(cometStyle.ionColor);
      u.uSpread.value=cometStyle.spread;u.uCurve.value=cometStyle.curve;u.uSplit.value=cometStyle.split;u.uIonStrength.value=cometStyle.ionStrength;
      head.material.uniforms.uColor.value.fromArray(cometStyle.headColor);head.material.uniforms.uSize.value=cometStyle.headSize;
      const referenceDuration=cometStyle.duration+(random()-.5)*3;
      seedPath(view,cometStart,cometEnd,cometStyle.travel*(.96+random()*.08));
      const alignment=clamp(cometStart.dot(cometEnd),-1,1);
      cometSpeed=Math.acos(alignment)/referenceDuration*1.3;
      cometTangent.copy(cometEnd).addScaledVector(cometStart,-alignment).normalize();
    }
    comet.visible=head.visible=visibility>.05&&cometActive;
    if(comet.visible){
      const travel=cometAge*cometSpeed;
      headPosition.copy(cometStart).multiplyScalar(Math.cos(travel)).addScaledVector(cometTangent,Math.sin(travel));
      if(env.sunDirection?.isVector3)sun.copy(env.sunDirection);else if(Array.isArray(env.sun))sun.fromArray(env.sun);else sun.set(-.4,-.7,.2);
      sun.normalize();away.copy(headPosition).multiplyScalar(headPosition.dot(sun)).sub(sun);
      if(away.lengthSq()<.001)away.set(.7,.4,.3);away.normalize();
      // Keep the scenic plume behind the downward flight, with only a small
      // anti-solar drift so it cannot swing into a vertical/horizontal streak.
      pathUp.copy(cometStart).multiplyScalar(Math.sin(travel)).addScaledVector(cometTangent,-Math.cos(travel));
      away.multiplyScalar(.08).addScaledVector(pathUp,.92).normalize();
      const fullSpan=cometStyle.span,floor=Math.min(.28,headPosition.y);
      let safeSpan=fullSpan;
      tailPosition.copy(headPosition).addScaledVector(away,fullSpan).normalize();
      // Near dawn, keep the high tail above the sea. Release that restriction
      // continuously as the head descends into the shader's horizon fade.
      if(tailPosition.y<floor){
        let low=0,high=fullSpan;
        for(let i=0;i<14;i++){
          const middle=(low+high)*.5;
          tailPosition.copy(headPosition).addScaledVector(away,middle).normalize();
          if(tailPosition.y>=floor)low=middle;else high=middle;
        }
        safeSpan=low;
      }
      const span=THREE.MathUtils.lerp(fullSpan,safeSpan,smooth(headPosition.y,.16,.32));
      tailPosition.copy(headPosition).addScaledVector(away,span).normalize().multiplyScalar(2070);headPosition.multiplyScalar(2070);
      // Constant-width support lets the shader grow a continuous plume from
      // the nucleus, rather than multiplying two trapezoidal tapers.
      quad(comet,headPosition,tailPosition,cometStyle.width,cometStyle.width);
      headGeometry.attributes.position.setXYZ(0,headPosition.x,headPosition.y,headPosition.z);headGeometry.attributes.position.needsUpdate=true;
      const alpha=visibility*(1-moon*.45)*smooth(cometAge,0,.9);
      comet.material.uniforms.uOpacity.value=alpha*.8;
      head.material.uniforms.uOpacity.value=alpha*smooth(headPosition.y/2070,0,.12);
      // Test the whole tail's bounds, so the nucleus can leave first without
      // cutting off a tail that is still crossing the screen. Coordinates here
      // are relative to the camera-following sky root, so use rotation only.
      view.updateWorldMatrix(true,false);viewRotation.copy(view.matrixWorldInverse).setPosition(0,0,0);
      clipFromSky.multiplyMatrices(view.projectionMatrix,viewRotation);cometFrustum.setFromProjectionMatrix(clipFromSky);
      cometBounds.setFromBufferAttribute(comet.geometry.attributes.position);
      if(cometFrustum.intersectsBox(cometBounds)){enteredView=true;outsideFor=0;}else if(enteredView)outsideFor+=dt;
      const belowHorizon=headPosition.y<=0&&cometBounds.max.y<2070*.12;
      if(outsideFor>=.35||belowHorizon||travel>=1.9)finishComet();
    }
  }
  function setQuality(value){
    quality=['high','medium','low'].includes(value)?value:'high';
    stars.geometry.setDrawRange(0,quality==='low'?1700:quality==='medium'?2900:catalogue.length);
    band.material.uniforms.uDetail.value=quality==='low'?0:1;
    shower.setQuality(quality);
  }
  function dispose(){if(disposed)return;disposed=true;guides.dispose();shower.dispose();group.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});group.removeFromParent();group.clear();}
  setQuality('high');
  return{group,catalogue,update,setQuality,setConstellationsVisible:guides.setVisible,setConstellationMode:guides.setMode,setMeteorsVisible:shower.setEnabled,setCometsVisible,setMeteorMode:shower.setMode,setCometMode,dispose};
}
