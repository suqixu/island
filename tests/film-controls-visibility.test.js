import test from 'node:test';
import assert from 'node:assert/strict';
import {createFilmPresentation} from '../src/film-presentation.js';

test('底栏重复唤出只在可见性变化时同步进度和可访问状态',()=>{
  const document=new EventTarget(),screen=new EventTarget(),controls=new EventTarget(),attributes=[],changes=[];
  const classes=new Set();
  screen.parentElement={classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove(){},add(){}}};
  screen.ownerDocument=document;screen.getBoundingClientRect=()=>({bottom:800});
  controls.contains=()=>false;controls.setAttribute=(name,value)=>attributes.push([name,value]);document.documentElement={};
  const view=createFilmPresentation({screen,controls,document,player:{getState:()=>({status:'paused'})},togglePlayback(){},onControlsVisibilityChange:visible=>changes.push(visible),settings:{controlsHideMs:2500,bottomRevealHeight:100,feedbackMs:700}});
  const move=y=>{const event=new Event('pointermove');Object.assign(event,{pointerType:'mouse',clientY:y});screen.dispatchEvent(event);};
  try{
    view.update({active:true});move(790);move(790);move(795);
    assert.deepEqual(changes,[false,true]);assert.deepEqual(attributes,[['aria-hidden','true'],['aria-hidden','false']]);assert.equal(controls.inert,false);assert.equal(classes.has('film-controls-visible'),true);
    move(400);move(400);
    assert.deepEqual(changes,[false,true,false]);assert.equal(controls.inert,true);assert.deepEqual(attributes.at(-1),['aria-hidden','true']);
    view.showControls({timed:false});assert.deepEqual(changes,[false,true,false,true]);
  }finally{view.dispose();}
});
