import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { colorFor } from './theme.js';

// Fixed capacity, including repeated UI events; never allocate effects per frame.
export function createEffects() {
  const group=new THREE.Group(), capacity=384, data=new Float32Array(capacity*3), colors=new Float32Array(capacity*3);
  const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(data,3)).setAttribute('color',new THREE.BufferAttribute(colors,3));
  const sparks=new THREE.Points(geometry,new THREE.PointsMaterial({size:.22,vertexColors:true,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false}));
  group.add(sparks); const particles=[]; let quality='high';
  const ringGeometry=new THREE.RingGeometry(1,1.12,40);ringGeometry.rotateX(-Math.PI/2);
  const rings=Array.from({length:8},()=>{const m=new THREE.Mesh(ringGeometry,new THREE.MeshBasicMaterial({color:'white',transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));m.visible=false;group.add(m);return {mesh:m,life:0};});
  const beamGeometry=new THREE.CylinderGeometry(1.2,3,110,8,1,true);
  const beams=Array.from({length:6},()=>{const m=new THREE.Mesh(beamGeometry,new THREE.MeshBasicMaterial({color:'white',transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));m.visible=false;group.add(m);return {mesh:m,life:0};});
  const summary=new THREE.Mesh(new THREE.BoxGeometry(7,6,3),new THREE.MeshBasicMaterial({color:'#c6a2ff',wireframe:true,transparent:true,opacity:.7}));summary.visible=false;group.add(summary);let summaryLife=0;
  const shock = new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{life:{value:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float life;void main(){float scan=pow(.5+.5*sin(v.y*110.),12.);float rim=pow(abs(v.x-.5)*2.,10.);gl_FragColor=vec4(vec3(2.5,.52,.12),life*(.08+scan*.25+rim*.5));}'}));
  shock.visible=false; group.add(shock);
  let ri=0,bi=0;
  function burst(item,type='celebrate',reduced=false) {
    const z=item?(item.z0+item.z1)/2:0, color=new THREE.Color(colorFor(item?.layer));
    const r=rings[ri++%rings.length];r.life=reduced?.12:1.2;r.mesh.position.set(0,.1,z);r.mesh.material.color.copy(color);r.mesh.visible=true;
    if(reduced)return;
    if(type==='beam'||type==='user_prompt') {const b=beams[bi++%beams.length];b.life=1.2;b.mesh.position.set(0,(item?.height??0)+55,z);b.mesh.material.color.copy(color).multiplyScalar(2.2);b.mesh.visible=true;}
    const count=quality==='high'?48:12;
    for(let i=0;i<count;i++) {if(particles.length>=capacity)particles.shift();const crumble=type==='compaction';particles.push({x:(Math.random()-.5)*6,y:crumble?Math.random()*(item?.height||8):.2,z:z+(Math.random()-.5)*Math.min(8,(item?.z1-item?.z0)||2),vx:(Math.random()-.5)*3,vy:crumble?-Math.random()*5:2+Math.random()*5,vz:(Math.random()-.5)*3,life:crumble?1.8:1.2,color});}
  }
  return {group,burst,summary(z,reduced,length=60){summaryLife=reduced?.12:2.8;shock.position.set(4.2,70,z/2);shock.scale.set(18,140,1);shock.rotation.y=Math.PI/2;shock.scale.x=Math.max(30,length);shock.visible=true;summary.position.set(0,-3,z);summary.visible=true;},setQuality(v){quality=v;},clear(){summaryLife=0;summary.visible=false;shock.visible=false;particles.length=0;geometry.setDrawRange(0,0);for(const r of [...rings,...beams]){r.life=0;r.mesh.visible=false;}},
    tick(dt,reduced) {
      summaryLife=Math.max(0,summaryLife-dt);shock.visible=summaryLife>0;shock.scale.y=140*Math.min(1,summaryLife/2.8);shock.position.y=shock.scale.y/2;shock.material.uniforms.life.value=Math.min(1,summaryLife);summary.visible=summaryLife>0;summary.position.y=reduced?3:-3+(1-summaryLife/1.8)*6;summary.material.opacity=Math.min(.7,summaryLife);
      for(const r of rings){r.life=Math.max(0,r.life-dt);r.mesh.visible=r.life>0;r.mesh.scale.setScalar(reduced?2:1+(1-r.life/1.2)*8);r.mesh.material.opacity=r.life*.45;}
      for(const b of beams){b.life=Math.max(0,b.life-dt);b.mesh.visible=b.life>0;b.mesh.material.opacity=b.life*.45;}
      if(reduced)particles.length=0;
      let n=0;
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;if(p.life<=0){particles.splice(i,1);continue;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;data.set([p.x,p.y,p.z],n*3);colors.set([p.color.r*p.life,p.color.g*p.life,p.color.b*p.life],n++*3);}
      geometry.setDrawRange(0,n);geometry.attributes.position.needsUpdate=true;geometry.attributes.color.needsUpdate=true;
    },
  };
}
