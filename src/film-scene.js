import {getEnvironment} from './simulation.js';
import * as THREE from 'three';
import {createFilmLibrary} from './film-library.js';
import {createFilmPlayer} from './film-player.js';
import {createFilmCamera} from './film-camera.js';
import {createFilmUI} from './film-ui.js';
import {createFilmSceneScheduling} from './film-scene-scheduling.js';
import {createFilmClock} from './film-clock.js';
import {REST_PAVILION_SITES} from './rest-pavilion-layout.js';
import filmConfig from './config/film.json' with {type:'json'};

const sources=import.meta.glob('./assets/data/films/*.json',{query:'?raw',eager:true,import:'default'});
const controlKeys=['enabled','autoRotate','enableDamping','minDistance','maxDistance','minPolarAngle','maxPolarAngle'];

export function createFilmScene({state,scene,camera,controls,island,woodlandLife,nightWildlife,restPavilions,views,ensureAudio,filmLibraryPanel,closePanel,
  capabilities,captureExtra=()=>({}),restoreExtra=()=>{},captureFrame=()=>{},onEnter=()=>{},onError=()=>{}}) {
  const point=new THREE.Vector3(),matrix=new THREE.Matrix4();
  let audio,ui,lastSample,disposed=false,silent=false,previewPending=false,seekPending=false,volume=filmConfig.presentation.volume;
  const clock=createFilmClock(state);
  const library=createFilmLibrary(sources,{capabilities});
  function woodlandPoint(shot){
    if(state.hour>=19||state.hour<6){const dots=scene.getObjectByName('林缘萤火虫'),positions=dots?.geometry.attributes.position;
      if(positions&&dots.geometry.drawRange.count){let brightest=0;const brightness=dots.geometry.attributes.aBrightness;for(let i=1;i<dots.geometry.drawRange.count;i++)if(brightness.getX(i)>brightness.getX(brightest))brightest=i;point.fromBufferAttribute(positions,brightest);if(point.lengthSq()>1)return point.clone();}}
    const subject=woodlandLife.getObservationTarget(),resident=subject?.position,trees=island.getWoodlandHabitats().trees;
    if(resident){
      const outward=subject.outward;outward.y=0;
      if(outward.lengthSq()<.01)outward.copy(resident).setY(0);
      const eye=shot.camera[0].position,yaw=Math.atan2(outward.x,outward.z)-Math.atan2(eye[0],eye[2]);
      return {position:resident,focus:subject.focus,quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw)};
    }
    return resident??trees[0]?.root.clone().add(new THREE.Vector3(0,1,0))??new THREE.Vector3(0,4,60);
  }
  const landmarks=Object.fromEntries(Object.entries(views).map(([id,view])=>[id,new THREE.Vector3(...view.target)]));
  landmarks.woodland=woodlandPoint;
  landmarks.moths=()=>nightWildlife?.getObservationTarget('moth',state.elapsed)??landmarks['pavilion-east'];
  landmarks.fireflies=()=>{const entry=nightWildlife?.getObservationTarget('firefly',state.elapsed);if(!entry)return woodlandPoint({camera:[{position:[0,0,1]}]});const yaw=Math.atan2(entry.outward.x,entry.outward.z);return {position:entry.position,quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw)};};
  landmarks.flowers=()=>{const observed=island.getFlowerObservationPoint?.(6,point);if(observed)return observed.clone();const flowers=scene.getObjectByName('洞前缤纷花瓣');if(!flowers?.count)return landmarks.cave;flowers.updateWorldMatrix(true,false);flowers.getMatrixAt(Math.min(6,flowers.count-1),matrix);return new THREE.Vector3(0,.568,0).applyMatrix4(matrix).applyMatrix4(flowers.matrixWorld);};
  REST_PAVILION_SITES.forEach((site,index)=>{landmarks[`pavilion-${site.id}`]=()=>({position:restPavilions[index].group.position.clone().add(new THREE.Vector3(0,1.7,0)),quaternion:restPavilions[index].group.quaternion});});
  const filmCamera=createFilmCamera({camera,controls,landmarks,heightAt:island.heightAtRendered});
  const scheduling=createFilmSceneScheduling({registry:capabilities,filmCamera});
  let appliedAudio,observationShot;
  function audioOptions(){return scheduling.active?capabilities.getMusicOptions?.()??{}:{};}
  function applyVolume(sample=lastSample){
    if(!audio||silent||!sample)return;
    const options=audioOptions();const playback={mode:options.mode??'single',trackId:options.track??player.getState().script?.music?.trackId,paused:player.getState().status!=='playing'||(options.paused??!sample.music),rate:1};const enabled=player.getState().status==='playing'&&options.enabled!==false;const encoded=JSON.stringify([playback,enabled]);if(encoded!==appliedAudio){audio.setMusicPlayback(playback);audio.setEnabled(enabled);appliedAudio=encoded;}
    audio.setMusicVolume((options.musicVolume??sample.music?.musicVolume??0)*(sample.music?.gain??1)*volume);
    audio.setAmbientVolume((options.ambientVolume??sample.music?.ambientVolume??.3)*Math.min(1,sample.time/2,(sample.shot.end===player.getState().duration?(player.getState().duration-sample.time)/2:1))*volume);
  }
  function restoreSaved(saved){
      let restoreError;try{scheduling.end();}catch(error){restoreError=error;}
      const elapsedAdvance=clock.restore(saved.state);
      camera.position.copy(saved.camera);controls.target.copy(saved.target);camera.fov=saved.fov;
      Object.assign(controls,saved.controls);camera.updateProjectionMatrix();controls.update();
      filmCamera.reset();restoreExtra(saved.extra,{elapsedAdvance});lastSample=undefined;if(restoreError)throw restoreError;
  }
  const player=createFilmPlayer({capabilities,
    capture(script){
      const saved={state:structuredClone(state),camera:camera.position.clone(),target:controls.target.clone(),fov:camera.fov,
        controls:Object.fromEntries(controlKeys.map(key=>[key,controls[key]])),extra:captureExtra()};
      try{scheduling.begin(script);}catch(error){scheduling.end();throw error;}
      try{
      clock.reset();controls.enabled=false;controls.autoRotate=false;controls.enableDamping=false;
      controls.minDistance=.5;controls.maxDistance=1000;controls.minPolarAngle=.01;controls.maxPolarAngle=Math.PI*.98;
      Object.assign(state,{running:false,autoWeather:false,autoSeason:false,autoMoon:false,speed:1,holdSunClock:false,holdMoonClock:false,moonNightEnding:null});
      filmCamera.reset();lastSample=undefined;appliedAudio=undefined;observationShot=undefined;onEnter(script);return saved;
      }catch(error){try{restoreSaved(saved);}catch(restoreError){throw new AggregateError([error,restoreError],'影片准备与恢复失败');}throw error;}
    },
    restore:restoreSaved,
    async prepare(script,{signal}){
      filmCamera.reset();clock.reset();silent=false;
      try{
        audio=await ensureAudio(signal);if(signal.aborted)return;
        audio.setMusicPlayback({mode:'single',trackId:script.music?.trackId,paused:!script.music,rate:1});audio.restartMusicTrack();
        audio.setMusicVolume(0);audio.setAmbientVolume(script.music?.ambientVolume??.3);
      }catch(error){if(signal.aborted)return;silent=true;console.warn('宣传片声音暂未就绪，继续静音播放',error);}
    },
    onFrame(sample){
      lastSample=sample;previewPending=true;const env=sample.environment;
      clock.step(scheduling.getModelTime(sample.time));
      Object.assign(state,{hour:env.hour,seasonIndex:env.season,weather:env.weather,snowCover:env.snowCover,cloudMode:'default'});
      scheduling.apply(sample);
      const kind=sample.shot.landmark==='moths'?'moth':sample.shot.landmark==='fireflies'?'firefly':null;
      if(kind&&nightWildlife&&(observationShot!==sample.shot.id||seekPending)){
        const actualEnv=scheduling.composeEnvironment(getEnvironment(state));
        restPavilions.forEach(pavilion=>pavilion.update(state.elapsed,actualEnv));
        nightWildlife.prepareObservation(kind,state.elapsed,actualEnv);
      }
      observationShot=sample.shot.id;
      filmCamera.apply(sample);
      applyVolume(sample);
      ui?.update(sample,player.getState());
    },
    onSeek(sample){seekPending=true;filmCamera.reset();if(audio&&!silent)audio.seekMusicTrack(sample.time);},
    onStatus(status){
      if(status.active&&audio&&!silent){const playing=status.status==='playing';const options=audioOptions();audio.setMusicPlayback({paused:!playing||(options.paused??!status.script.music),rate:1});audio.setEnabled(playing&&options.enabled!==false);}
      ui?.update(lastSample,status);
    },
  });
  ui=createFilmUI({player,library,onError,onScreenshot:captureFrame,getVolume:()=>volume,setVolume:value=>{volume=Math.max(0,Math.min(1,value));applyVolume();},filmLibraryPanel,closePanel});
  const visibility=()=>{if(document.hidden)player.pause();};document.addEventListener('visibilitychange',visibility);
  return {
    update(now){if(disposed)return {active:false};try{player.update(now);}catch(error){onError(error);}const status=player.getState(),needsFrame=previewPending,seeked=seekPending;previewPending=seekPending=false;return {...status,needsFrame,seeked,paused:status.active&&status.status!=='playing'};},
    reframe(){if(!disposed&&player.getState().active&&filmCamera.reframe())previewPending=true;},
    invalidate(){if(!disposed&&player.getState().active)previewPending=true;},
    composeEnvironment(env,options){try{return scheduling.composeEnvironment(env,options);}catch(error){try{player.exit();}catch(restoreError){onError(restoreError);}onError(error);return env;}},get scheduled(){return scheduling.active;},
    get active(){return player.getState().active;},get playing(){return player.getState().status==='playing';},
    getState:player.getState,
    dispose(){if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',visibility);player.dispose();ui.dispose();filmCamera.dispose();},
  };
}
