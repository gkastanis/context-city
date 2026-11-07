import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPixels, pagePlacement, GALLERY, portalCrossing, tokenRuler } from '../src/scene/paging.js';

test('pixel wrapping measures proportional glyphs, preserves paragraphs and splits long words', () => {
  const measure = s => Array.from(s).reduce((n,c) => n + (c === 'W' ? 12 : 3), 0);
  for(const text of ['WWWW narrow words', 'a'.repeat(10000), 'one\n\nthree', '<script>alert(1)</script>', '🙂'.repeat(20)]) {
    const lines=wrapPixels(text,48,measure);
    assert.ok(lines.every(line=>measure(line)<=48));
    assert.equal(lines.join('').replaceAll(' ',''), text.replaceAll('\n','').replaceAll(' ',''));
  }
  assert.deepEqual(wrapPixels('one\n\nthree',48,measure),['one','','three']);
  assert.equal(wrapPixels('W'.repeat(100),48,measure,3).length,3);
});

test('every sheet and frame stays inside either wall with a margin', () => {
  for(let i=0;i<1000;i++) {
    const p=pagePlacement(i);
    const outer=Math.abs(p.x)+Math.abs(Math.cos(p.rotation))*6.12/2+.025;
    assert.ok(outer < GALLERY.wallX-GALLERY.wallThickness/2-.1);
    assert.equal(p.rotation, i%2 ? -Math.PI/2 : Math.PI/2);
    if(i)assert.equal(p.z-pagePlacement(i-1).z,7);
  }
});

test('portal crossing interpolates at the plane and respects the opening bounds', () => {
  const point=(x,y,z)=>({x,y,z});
  for(const direction of [-1,1]) {
    for(const x of [-1.65,0,1.65])for(const y of [0,1.7,3.8])assert.ok(portalCrossing(point(x,y,-direction),point(x,y,direction)));
    for(const [x,y]of [[1.66,1.7],[-1.66,1.7],[0,-.01],[0,3.81]])assert.equal(portalCrossing(point(x,y,-direction),point(x,y,direction)),false);
  }
  assert.equal(portalCrossing(point(0,1,1),point(0,1,2)),false);
  assert.ok(portalCrossing(point(-3,1,-2),point(3,1,2)));
});

test('ruler uses the actual start and scaled token span including zero', () => {
  const ticks=tokenRuler(120400,2300,100);
  assert.equal(ticks[0].token,120400);assert.equal(ticks.at(-1).token,122700);
  assert.equal(ticks[1].token-ticks[0].token,2300/8);
  assert.ok(tokenRuler(0,0,20).every(t=>t.token===0));
});
