import { user, assistant, call, result } from './t1c-cases.mjs';
// Result r1 is a sibling of a2; r2 is a sibling of a3.
export const parallelSiblings = [
  user('u', 'Synthetic parallel prompt', { parentUuid: null }),
  assistant('a1', 'm1', [call('t1')], 'u', { apiBlockIndex: 0 }),
  assistant('a2', 'm1', [call('t2')], 'a1', { apiBlockIndex: 1 }),
  assistant('a3', 'm1', [call('t3')], 'a2', { apiBlockIndex: 2 }),
  user('r1', [result('t1')], { parentUuid: 'a1' }),
  user('r2', [result('t2')], { parentUuid: 'a2' }),
  user('r3', [result('t3')], { parentUuid: 'a3' }),
  user('next', 'Synthetic next prompt', { parentUuid: 'r3' }),
  assistant('done', 'm2', [], 'next'),
];
