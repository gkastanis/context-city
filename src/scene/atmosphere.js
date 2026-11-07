import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js/+esm';
import { OutputPass } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/postprocessing/OutputPass.js/+esm';

// All environmental resources have scene lifetime, independent of request size.
export function createAtmosphere(scene, renderer, camera) {
  const group = new THREE.Group(); scene.add(group);
  const uniforms = { zenith: { value: new THREE.Color('#1c2c4e') }, horizon: { value: new THREE.Color('#56769e') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40000, 24, 16), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 direction; uniform vec3 zenith,horizon; void main(){float h=normalize(direction).y;
      vec3 c=mix(horizon,zenith,smoothstep(-.05,.65,h))*.22;c+=vec3(.015,.009,.015)*exp(-abs(h)*24.);gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  })); sky.renderOrder = -10; group.add(sky);
  let seed = 937; const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const points = new Float32Array(1200 * 3);
  for (let i=0;i<1200;i++) { const a=random()*Math.PI*2, h=.12+random()*.88, r=Math.sqrt(1-h*h)*18000;
    points.set([Math.cos(a)*r,h*18000,Math.sin(a)*r],i*3); }
  const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(points,3)),
    new THREE.PointsMaterial({ color:'#a9c8ff',size:15,sizeAttenuation:true,transparent:true,opacity:.7,depthWrite:false,fog:false })); group.add(stars);
  const dustPositions = new Float32Array(160*3);
  for(let i=0;i<160;i++) dustPositions.set([(random()-.5)*90,2+random()*26,random()*180],i*3);
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(dustPositions,3)),
    new THREE.PointsMaterial({color:'#9adfff',size:.10,transparent:true,opacity:.35,blending:THREE.AdditiveBlending,depthWrite:false})); group.add(dust);
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene,camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1,1),.38,.35,.85); composer.addPass(bloom); composer.addPass(new OutputPass());
  // Counters must include every pass, rather than just the last fullscreen quad.
  renderer.info.autoReset = false;
  scene.fog = new THREE.FogExp2('#2a3b5c',.0021);
  let rangeStart=0, rangeEnd=0;
  let fill=0, target=0, time=0, quality=matchMedia('(pointer: coarse)').matches?'low':'high';
  const stops = [0,.5,.74,1], colors = ['#56769e','#7d6290','#c4804e','#c9545c'];
  const a=new THREE.Color(), b=new THREE.Color();
  return {
    setRange(start,end) { rangeStart=start; rangeEnd=end; },
    setFill(value,reduced) { if(!Number.isFinite(value)||value<0) throw new RangeError('Atmosphere fill must be finite and nonnegative'); target=value;if(reduced) fill=target; },
    setQuality(value) { quality=value; dust.geometry.setDrawRange(0,value==='high'?160:40); },
    resize(w,h) { composer.setSize(w,h); bloom.setSize(Math.ceil(w*.5),Math.ceil(h*.5)); },
    tick(dt,reduced,inside) {
      time+=reduced?0:dt; fill += (target-fill)*(reduced?1:1-Math.exp(-dt*8));
      let i=0;while(i<2&&fill>stops[i+1])i++;
      const t=THREE.MathUtils.clamp((fill-stops[i])/(stops[i+1]-stops[i]),0,1);
      uniforms.horizon.value.copy(a.set(colors[i])).lerp(b.set(colors[i+1]),t);
      uniforms.zenith.value.copy(uniforms.horizon.value).multiplyScalar(.08);
      scene.fog.color.copy(uniforms.horizon.value).multiplyScalar(inside?.25:.5);
      scene.fog.density=inside?.022:Math.min(.0021,.45/Math.max(100,Math.hypot(camera.position.x,camera.position.y,camera.position.z-(rangeStart+rangeEnd)/2)));
      sky.position.copy(camera.position); stars.position.copy(camera.position);
      sky.visible=stars.visible=dust.visible=!inside;
      dust.position.z=camera.position.z-40; dust.position.y=Math.sin(time*.12)*2;
      return {time,fill};
    },
    render() { renderer.info.reset(); if(quality==='high') composer.render();else renderer.render(scene,camera); },
    dispose() { for(const pass of composer.passes) pass.dispose?.();composer.dispose(); },
  };
}
