import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilmPresentation} from '../src/film-presentation.js';

function fixture(){
  const document=new EventTarget(),root={classList:{toggle(){},remove(){},add(){}}},screen=new EventTarget(),controls=new EventTarget();
  screen.parentElement=root;screen.ownerDocument=document;screen.getBoundingClientRect=()=>({bottom:800});controls.contains=()=>false;controls.setAttribute=()=>{};
  let exits=0,requests=0,complete;
  document.documentElement={requestFullscreen(){requests++;return new Promise(resolve=>{complete=()=>{document.fullscreenElement=document.documentElement;resolve();};});}};
  document.exitFullscreen=()=>{exits++;document.fullscreenElement=null;return Promise.resolve();};
  const view=createFilmPresentation({screen,controls,document,player:{getState:()=>({status:'playing'})},togglePlayback(){},settings:{defaultFullscreen:true,controlsHideMs:2500,bottomRevealHeight:100,feedbackMs:700}});
  return {document,view,get requests(){return requests;},get exits(){return exits;},complete:()=>complete()};
}

test('准备期间退出后，迟到的原生全屏完成也会被收回',async()=>{
  const f=fixture();f.view.update({active:true});f.view.enterFullscreen();assert.equal(f.requests,1);
  f.view.update({active:false});f.complete();await Promise.resolve();await Promise.resolve();
  assert.equal(f.exits,1);assert.equal(f.document.fullscreenElement,null);f.view.dispose();assert.equal(f.exits,1);
});

test('原本已经全屏时，退出和释放播放器均保留原全屏',()=>{
  const f=fixture();f.document.fullscreenElement=f.document.documentElement;f.view.update({active:true});f.view.enterFullscreen();assert.equal(f.requests,0);
  f.view.update({active:false});f.view.dispose();assert.equal(f.exits,0);assert.equal(f.document.fullscreenElement,f.document.documentElement);
});
