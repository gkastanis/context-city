// All navigation acquires an owner here, invalidating any previous transition.
export function createModes(onChange = () => {}) {
  let mode = 'city', owner = 'orbit', transitionId = 0, info = {};
  return {
    request(next, nextOwner, details = {}) {
      if (!['city', 'inside', 'reading'].includes(next)) throw new TypeError(`Invalid mode: ${next}`);
      mode = next; owner = nextOwner; info = details;
      const id = ++transitionId;
      onChange(mode, { ...info, owner, transitionId: id });
      return id;
    },
    valid: id => id === transitionId,
    get: () => mode,
    owner: () => owner,
    reset() { return this.request('city', 'orbit', { reset: true }); },
  };
}
