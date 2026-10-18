import * as THREE from 'three';

const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

/** A few anchored surf crowns, rather than one repeating card per droplet. */
export function createImpactPlumes(scene,atlas,random=Math.random) {
  const capacity=48,geometry=new THREE.InstancedBufferGeometry();
  geometry.setIndex([0,1,2,2,1,3]);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-.5,0,0,.5,0,0,-.5,1,0,.5,1,0],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));
  const centers=new Float32Array(capacity*3),widths=new Float32Array(capacity),heights=new Float32Array(capacity);
  const alphas=new Float32Array(capacity),mists=new Float32Array(capacity),variants=new Float32Array(capacity),angles=new Float32Array(capacity);
  const buffers={aCenter:[centers,3],aWidth:[widths,1],aHeight:[heights,1],aAlpha:[alphas,1],aMist:[mists,1],aVariant:[variants,1],aAngle:[angles,1]};
  for(const [name,[array,size]] of Object.entries(buffers))geometry.setAttribute(name,new THREE.InstancedBufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({
    uniforms:{uSprayAtlas:atlas.map,uSprayReady:atlas.ready,uLight:{value:.7}},
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`attribute vec3 aCenter;attribute float aWidth;attribute float aHeight;
      attribute float aAlpha;attribute float aMist;attribute float aVariant;attribute float aAngle;
      varying vec2 vUv;varying float vAlpha;varying float vMist;varying float vVariant;
      void main(){
        vec3 right=normalize(vec3(viewMatrix[0][0],0.0,viewMatrix[2][0])+vec3(0.00001,0.0,0.00001));
        vec2 q=position.xy*vec2(aWidth,aHeight);
        float s=sin(aAngle),c=cos(aAngle);
        vec3 world=aCenter+right*(q.x*c-q.y*s)+vec3(0.0,q.x*s+q.y*c,0.0);
        vec3 view=normalize(cameraPosition-aCenter);
        vUv=uv;vAlpha=aAlpha*(1.0-smoothstep(0.48,0.88,abs(view.y)));
        vMist=aMist;vVariant=aVariant;
        gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);
      }`,
    fragmentShader:`uniform sampler2D uSprayAtlas;uniform float uSprayReady;uniform float uLight;
      varying vec2 vUv;varying float vAlpha;varying float vMist;varying float vVariant;
      void main(){
        if(uSprayReady<0.5||vAlpha<0.001)discard;
        vec2 cell=vec2(mod(vVariant,2.0),1.0-floor(vVariant/2.0));
        vec2 uv=clamp(vUv,vec2(0.015),vec2(0.985));
        vec4 body=texture2D(uSprayAtlas,(cell+uv)*0.5);
        vec4 mist=texture2D(uSprayAtlas,(vec2(0.0,0.0)+uv)*0.5);
        vec3 luminance=vec3(0.2126,0.7152,0.0722);
        float bodyDetail=dot(body.rgb,luminance);
        // Retain the foamy filaments while thinning the smooth glassy core;
        // otherwise a clear-water photograph reads as a solid billboard wall.
        float aerated=smoothstep(0.16,0.68,bodyDetail);
        float density=mix(body.a*(0.25+aerated*0.75),mist.a*0.32,vMist);
        float detail=dot(mix(body.rgb,mist.rgb,vMist),luminance);
        vec2 edge=smoothstep(vec2(0.0),vec2(0.065),vUv)*(1.0-smoothstep(vec2(0.935),vec2(1.0),vUv));
        float baseFade=smoothstep(0.0,0.15,vUv.y);
        float alpha=density*vAlpha*edge.x*edge.y*baseFade;
        if(alpha<0.004)discard;
        gl_FragColor=vec4(vec3(0.62,0.68,0.70)*(0.55+sqrt(max(detail,0.0))*0.45)*uLight,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='拍岸破浪水冠';mesh.frustumCulled=false;mesh.renderOrder=2;mesh.visible=false;
  const pool=Array.from({length:capacity},()=>({age:10,life:1,x:0,y:0,z:0,vx:0,vz:0,width:0,height:0,opacity:0}));
  let limit=capacity,cursor=0,attached=false,disposed=false;
  geometry.instanceCount=limit;
  function emit({x,y,z,impact,nx,nz,wind}) {
    if(disposed||impact<.075)return false;
    // Neighbouring bathymetry samples describe one collision, not many plumes.
    for(let i=0;i<limit;i++)if(pool[i].age<pool[i].life*.65&&Math.hypot(pool[i].x-x,pool[i].z-z)<12)return false;
    const i=cursor;cursor=(cursor+1)%limit;
    const p=pool[i];p.age=0;p.life=1.6+random()*.7;p.x=x;p.y=y;p.z=z;
    p.vx=wind[0]*2.5-nx*2;p.vz=wind[1]*2.5-nz*2;
    const force=Math.sqrt(impact);
    p.width=7+force*10+random()*2;p.height=5+force*9;
    p.opacity=.55+force*.35;
    variants[i]=random()<.5?0:1;angles[i]=(random()-.5)*.24;
    if(!attached){scene.add(mesh);attached=true;}
    return true;
  }
  function update(delta,env={}) {
    if(disposed||!attached)return false;
    let active=0;
    for(let i=0;i<limit;i++) {
      const p=pool[i];p.age+=delta;const t=p.age/p.life;
      if(t>=1){alphas[i]=0;continue;}
      active++;
      centers[i*3]=p.x+p.vx*p.age;centers[i*3+1]=p.y+Math.sin(t*Math.PI)*.25-smooth(.45,1,t)*1.4;
      centers[i*3+2]=p.z+p.vz*p.age;
      widths[i]=p.width*(.65+t*.95);
      heights[i]=p.height*(.2+.8*smooth(0,.35,t))*(1-.5*smooth(.45,1,t));
      alphas[i]=p.opacity*smooth(0,.1,t)*(1-smooth(.35,1,t));
      mists[i]=smooth(.3,.85,t);
    }
    material.uniforms.uLight.value=.12+(env.daylight??1)*.65
      *(1-(env.cloudiness??0)*.22)*(1-(env.storm??0)*.35);
    mesh.visible=active>0;
    for(const name of Object.keys(buffers))geometry.attributes[name].needsUpdate=true;
    return active>0;
  }
  function setQuality(quality){limit=quality==='low'?12:quality==='medium'?24:capacity;geometry.instanceCount=limit;cursor%=limit;
    for(let i=limit;i<capacity;i++){pool[i].age=10;alphas[i]=0;}}
  function dispose(){if(disposed)return;disposed=true;scene.remove(mesh);geometry.dispose();material.dispose();}
  return {emit,update,setQuality,dispose};
}
