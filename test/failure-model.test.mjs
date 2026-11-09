import test from 'node:test';
import assert from 'node:assert/strict';
import { failurePin, districtSkylines } from '../src/scene/failure-model.js';

test('failure stems rise from the roof above the local district skyline', () => {
  const layout = {items:[{blockId:'small',height:5},{blockId:'tower',height:180},{blockId:'other',height:220}],
    districts:[{blockIds:['small','tower']},{blockIds:['other']}]};
  const skyline = districtSkylines(layout);
  const pin = failurePin(5, skyline.get('small'));
  assert.equal(pin.base,5.15);
  assert.ok(pin.base+pin.height > 180);
  assert.ok(pin.base+pin.height < 220);
  assert.equal(failurePin(5,180,false).visible,false);
  assert.ok(failurePin(220,180).height>0);
});
