import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import film from '../src/assets/data/films/isola-four-seasons.json' with {type:'json'};
import {createFilmCamera} from '../src/film-camera.js';
import {parseFilmScript,sampleFilmScript} from '../src/film-script.js';
import {getMoonBackdropDirection,getMoonBackdropScale} from '../src/moon-framing.js';
import {createSimulation,getEnvironment} from '../src/simulation.js';
import {LIGHTHOUSE_SITE} from '../src/lighthouse-layout.js';
import {createLighthouse} from '../src/models/lighthouse.js';
import {getIslandPathLayout} from '../src/path-layout.js';
import {heightAt} from '../src/terrain.js';
import {CAVE_LAYOUT} from '../src/cave-layout.js';
import cameraConfig from '../src/config/camera.json' with {type:'json'};
import {REST_PAVILION_SITES} from '../src/rest-pavilion-layout.js';

test('四时一日灯塔镜头收尾的完整月轮位于黑边以内且露出海面',()=>{
  const script=parseFilmScript(film);
  const layout=getIslandPathLayout({heightAt,caveEndpoint:CAVE_LAYOUT.approach});
  const lighthouse=createLighthouse(new THREE.Scene(),{...LIGHTHOUSE_SITE,heightAt:layout.heightAtRendered});
  const landmark=lighthouse.group.position.clone().add(new THREE.Vector3(0,cameraConfig.lighthouseView.targetHeight,0));
  try {
    for(const [width,height]of [[1280,800],[942,830],[390,844],[844,390],[320,700]]){
      const camera=new THREE.PerspectiveCamera(50,width/height,.5,65000),controls={target:new THREE.Vector3()};
      const director=createFilmCamera({camera,controls,landmarks:{lighthouse:landmark},heightAt:layout.heightAtRendered});
      for(const time of [162,163,164,164.3]){
        const sample=sampleFilmScript(script,time);director.apply(sample);camera.updateMatrixWorld(true);
        const env=getEnvironment(createSimulation({hour:sample.environment.hour,autoMoon:false}));
        const direction=getMoonBackdropDirection(camera,width,env),size=getMoonBackdropScale(camera,width,height,env.moonPhase,direction);
        const center=camera.position.clone().addScaledVector(direction,1900),screen=center.clone().project(camera);
        const depth=1900*direction.dot(camera.getWorldDirection(new THREE.Vector3()));
        const radiusY=size/2/(depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))),radiusX=radiusY/camera.aspect;
        assert.ok(screen.y+radiusY<.84&&screen.y-radiusY>-.84,`${width}×${height} ${time}s 月轮不能被上下黑边截断`);
        assert.ok(Math.abs(screen.x)+radiusX<.95,'月轮不能被左右边缘截断');
        const up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
        // 远海绘制会覆盖海平线下的背景月盘，不能只检查月盘世界高度大于0。
        assert.ok(center.y-up.y*size/2>camera.position.y,`${width}×${height} ${time}s 月轮下缘不能被海面切去`);
      }
      director.dispose();
    }
  } finally {lighthouse.dispose();}
});

test('四时一日亭子夜景全程为完整月轮留出安全天空',()=>{
  const script=parseFilmScript(film),site=REST_PAVILION_SITES[0],landmark={position:new THREE.Vector3(site.position.x,40,site.position.z),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(site.entranceDirection.x,site.entranceDirection.z))};
  for(const [width,height]of [[1280,800],[942,728],[390,844],[844,390],[320,700]]){
    const camera=new THREE.PerspectiveCamera(50,width/height,.5,65000),controls={target:new THREE.Vector3()};
    const director=createFilmCamera({camera,controls,landmarks:{'pavilion-south':landmark}});
    for(let time=165.7;time<=173.3;time+=.4){
      const sample=sampleFilmScript(script,time);director.apply(sample);camera.updateMatrixWorld(true);
      const env=getEnvironment(createSimulation({hour:sample.environment.hour,autoMoon:false}));
      const direction=getMoonBackdropDirection(camera,width,env),size=getMoonBackdropScale(camera,width,height,env.moonPhase,direction);
      const center=camera.position.clone().addScaledVector(direction,1900),screen=center.clone().project(camera),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
      const depth=1900*direction.dot(camera.getWorldDirection(new THREE.Vector3()));
      const radiusY=size/(2*depth*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
      assert.ok(screen.y+radiusY<.84&&screen.y-radiusY>-.84,`${width}×${height} ${time.toFixed(1)}s 亭子镜头不能截断月轮`);
      assert.ok(center.y-up.y*size/2>camera.position.y,'完整月轮须高于海平线');
    }
    director.dispose();
  }
});
