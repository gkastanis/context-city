import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

// Fit actual box corners at a fixed diagonal azimuth and ground elevation.
// Work on a clone so calculating a destination never interrupts a flight.
export function fitMetropolis(source, points, {width,height}, free) {
  const camera=source.clone();
  const direction=new THREE.Vector3(-1,Math.SQRT2*Math.tan(32.5*Math.PI/180),-1).normalize();
  const right=new THREE.Vector3().crossVectors(direction.clone().negate(),camera.up).normalize();
  const up=new THREE.Vector3().crossVectors(right,direction.clone().negate()).normalize();
  const centre=new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const desiredX=free.x+free.w/2,desiredY=free.y+free.h/2;
  const tangent=Math.tan(camera.fov*Math.PI/360);
  const local=new THREE.Vector3(),projected=new THREE.Vector3();
  function evaluate(distance) {
    const target=centre.clone();
    let box;
    for(let pass=0;pass<16;pass++){
      camera.position.copy(target).addScaledVector(direction,distance);
      camera.lookAt(target);camera.updateMatrixWorld(true);
      box={x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity};
      let depth=0;
      for(const p of points){
        local.copy(p).applyMatrix4(camera.matrixWorldInverse);
        // A point behind the near plane cannot be a valid fit.
        if(-local.z<=camera.near)return {share:Infinity,target};
        depth-=local.z;
        projected.copy(p).project(camera);
        const x=(projected.x+1)*width/2,y=(1-projected.y)*height/2;
        box.x0=Math.min(box.x0,x);box.x1=Math.max(box.x1,x);
        box.y0=Math.min(box.y0,y);box.y1=Math.max(box.y1,y);
      }
      const dx=(box.x0+box.x1)/2-desiredX,dy=(box.y0+box.y1)/2-desiredY;
      if(Math.abs(dx)<.01&&Math.abs(dy)<.01)break;
      const scale=2*(depth/points.length)*tangent/height;
      target.addScaledVector(right,dx*scale).addScaledVector(up,-dy*scale);
    }
    return {share:Math.max((box.x1-box.x0)/free.w,(box.y1-box.y0)/free.h),target};
  }
  let low=0,high=Math.max(25,new THREE.Box3().setFromPoints(points).getSize(new THREE.Vector3()).length());
  while(evaluate(high).share>.8)high*=2;
  for(let i=0;i<24;i++){
    const mid=(low+high)/2;
    if(evaluate(mid).share>.8)low=mid;else high=mid;
  }
  const {target}=evaluate(high);
  return {target,position:target.clone().addScaledVector(direction,high)};
}
