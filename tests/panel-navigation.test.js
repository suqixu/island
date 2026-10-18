import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelNavigation} from '../src/panel-navigation.js';

class Element extends EventTarget{
  constructor(document){super();this.ownerDocument=document;this.children=[];this.hidden=false;this.inert=false;this.scrollTop=0;this.style={height:''};this.attributes=new Map();const classes=new Set();this.classList={toggle(name,enabled){enabled?classes.add(name):classes.delete(name);},contains:name=>classes.has(name)};}
  append(element){element.parentElement=this;this.children.push(element);}
  prepend(element){element.parentElement=this;this.children.unshift(element);}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getBoundingClientRect(){return {height:512};}
  remove(){this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
}
test('原设置面板只有一个返回，按访问顺序恢复影片与设置，并保留滚动和隐藏状态',()=>{
  const document={createElement(){return new Element(this);}},panel=document.createElement(),header=document.createElement(),settings=document.createElement(),hidden=document.createElement();hidden.hidden=true;hidden.inert=true;panel.append(header);panel.append(settings);panel.append(hidden);panel.scrollTop=125;
  const navigation=createPanelNavigation(header),films=document.createElement(),updates=document.createElement();panel.append(films);panel.append(updates);navigation.register('films',films);navigation.register('updates',updates);
  navigation.show('films');films.scrollTop=70;assert.equal(header.children.length,1);assert.equal(settings.hidden,true);assert.equal(panel.style.height,'512px');navigation.show('updates');navigation.back();assert.equal(navigation.current,'films');assert.equal(films.hidden,false);assert.equal(films.scrollTop,70);
  navigation.show('films');assert.equal(navigation.current,'films','再次打开同一页不重置导航');navigation.back();assert.equal(navigation.current,'settings');assert.equal(settings.hidden,false);assert.equal(hidden.hidden,true);assert.equal(hidden.inert,true);assert.equal(panel.scrollTop,125);assert.equal(header.children[0].hidden,true);
  navigation.dispose();assert.equal(header.children.length,0);
});
