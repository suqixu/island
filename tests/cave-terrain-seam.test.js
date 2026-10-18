import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createIsland} from '../src/models/island.js';
import {caveToLocal,caveToWorld} from '../src/cave-layout.js';
import {applyCaveOpening} from '../src/models/island-cave.js';

const point=(side,height,forward)=>{
  const p=caveToWorld(side,height,forward);return new THREE.Vector3(p.x,p.y,p.z);
};

// Removing whole intersecting terrain cells exposes sky above/alongside the
// smaller portal. These elevated rays reproduce the actual visible openings.
test('洞口上方与斜侧保留未开洞的山皮，不因整块三角面删除而漏出天空',()=>{
  const island=createIsland(new THREE.Scene()),land=island.group.getObjectByName('连续海床与火山岛');
  const geometry=land.geometry.clone(),position=geometry.attributes.position,indices=[];
  // Limit ray checks to the actual seam; distant back slopes must not hide gaps.
  for(let i=0;i<geometry.index.count;i+=3){
    const vertex=geometry.index.getX(i),local=caveToLocal({x:position.getX(vertex),y:position.getY(vertex),z:position.getZ(vertex)});
    if(Math.abs(local.side)<10&&Math.abs(local.forward)<10)indices.push(...[0,1,2].map(offset=>geometry.index.getX(i+offset)));
  }
  geometry.setIndex(indices);
  const patch=new THREE.Mesh(geometry,land.material);
  const cave=island.group.getObjectByName('东南山侧天然岩洞');
  const walls=['厚岩拱与裂隙洞口','天然岩洞内壁','洞穴坡口与地面','洞穴深处不规则岩壁'].map(name=>cave.getObjectByName(name));
  island.group.updateWorldMatrix(true,true);patch.updateMatrixWorld();
  try{
    const cases=[
      {from:[0,9,12],to:[2,6.2,0]},
      {from:[4,10,12],to:[2.4,6.4,0]},
      {from:[4,10,12],to:[2.6,6.2,0]},
      {from:[4,10,12],to:[2.6,6.4,0]},
      {from:[-4,10,12],to:[-.6,6.4,0]},
      {from:[-4,10,12],to:[-.4,6.4,0]},
    ];
    for(const {from,to} of cases){
      const origin=point(...from),direction=point(...to).sub(origin).normalize();
      const hits=new THREE.Raycaster(origin,direction,0,40).intersectObjects([patch,...walls],false);
      assert.ok(hits.length>0,`洞顶接缝漏空：相机 ${from}，目标 ${to}`);
    }
  }finally{geometry.dispose();island.dispose();}
});

test('洞口边界精确裁切保留外侧面积，并插值UV与地表属性',()=>{
  const vertices=[point(2,1.5,0),point(5,1.5,0),point(5,2.5,0)];
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flatMap(v=>v.toArray()),3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1],2));
  geometry.setAttribute('aBiome',new THREE.Float32BufferAttribute([0,1,1],1));
  geometry.setIndex([0,1,2]);
  const material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(geometry,material);
  try{
    assert.equal(applyCaveOpening(mesh),1);
    const p=geometry.attributes.position,uv=geometry.attributes.uv,biome=geometry.attributes.aBiome,index=geometry.index;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3(),edge=new THREE.Vector3();let area=0;
    for(let i=0;i<index.count;i+=3){
      a.fromBufferAttribute(p,index.getX(i));b.fromBufferAttribute(p,index.getX(i+1));c.fromBufferAttribute(p,index.getX(i+2));
      area+=cross.subVectors(b,a).cross(edge.subVectors(c,a)).length()*.5;
      for(let corner=0;corner<3;corner++){
        const n=index.getX(i+corner),local=caveToLocal(new THREE.Vector3().fromBufferAttribute(p,n));
        assert.ok(local.side>=3.35-1e-5,'开口内部应实际挖空');
        assert.ok(Math.abs(uv.getX(n)-(local.side-2)/3)<1e-5);
        assert.ok(Math.abs(uv.getY(n)-(local.height-1.5))<1e-5);
        assert.ok(Math.abs(biome.getX(n)-uv.getX(n))<1e-6);
      }
    }
    // Original triangle 3×1/2, minus the 1.35×.45/2 piece inside the opening.
    assert.ok(Math.abs(area-1.19625)<1e-5,`山皮外侧面积应保留，实际${area}`);
    const count=index.count;assert.equal(applyCaveOpening(mesh),0);assert.equal(geometry.index.count,count);
  }finally{geometry.dispose();material.dispose();}
});

test('俯视洞口后缘的真实缺缝射线被外壳封闭，中央入口和内部接缝保持通行',()=>{
  const island=createIsland(new THREE.Scene());island.group.updateWorldMatrix(true,true);
  const targets=['连续海床与火山岛','厚岩拱与裂隙洞口','天然岩洞内壁','洞穴坡口与地面'].map(name=>island.group.getObjectByName(name));
  try{
    for(const [side,forward]of [[3.2,-1.1],[3.3,-1.1],[3.2,-.85],[3.3,-.85],[-3.2,-1.1]]){
      const origin=point(side,14,forward),hits=new THREE.Raycaster(origin,new THREE.Vector3(0,-1,0),0,20).intersectObjects(targets,false);
      assert.ok(hits.length>0,`外壳后沿存在真实空洞 side=${side}, forward=${forward}`);
      assert.ok(caveToLocal(hits[0].point).height>3.5,'俯视应命中贴山外壳，不能用深处地面掩盖缺口');
    }
    const origin=point(0,2,10),direction=point(0,2,-2).sub(origin).normalize();
    const hits=new THREE.Raycaster(origin,direction,0,12).intersectObjects(targets,false);
    assert.equal(hits.length,0,'不能以封住中央入口来修外侧缝隙');
  }finally{island.dispose();}
});
