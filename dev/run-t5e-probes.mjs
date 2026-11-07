// Keep the requested Python server and each browser probe in one process group.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const server = spawn('python3', ['-m','http.server','8873','--bind','127.0.0.1'], {stdio:'ignore'});
const env = {...process.env, SCENE_URL:'http://127.0.0.1:8873', T5B_URL:'http://127.0.0.1:8873'};
try {
  let ready = false;
  for(let i=0;i<100;i++) {
    try { const r=await fetch('http://127.0.0.1:8873/'); if(r.ok){ready=true;break;} } catch {}
    await new Promise(r=>setTimeout(r,50));
  }
  if(!ready) throw new Error('Local Python server did not start');
  for(const probe of process.argv.slice(2)) {
    console.log(`Running ${probe}`);
    const child=spawn(process.execPath,[probe],{env,stdio:'inherit'});
    const [code]=await once(child,'exit');
    if(code!==0) {process.exitCode=code??1;break;}
  }
}finally{server.kill();}
