// Only a boolean display preference is persisted, never session data.
export function readDistrictPreference() {
  try {return localStorage.getItem('context-city-districts')!=='false';}catch{return true;}
}
export function saveDistrictPreference(value) {
  try {localStorage.setItem('context-city-districts',String(!!value));}catch{/* Preferences are optional. */}
}
