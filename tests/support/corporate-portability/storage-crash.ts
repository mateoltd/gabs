import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export type StorageCrash = {
  target: "main" | "utility";
  phase: "before" | "committed";
};

/** Wrap the real storage worker's request/reply boundary without changing its writes. */
export async function storageCrashWorker(
  directory: string,
  crash: StorageCrash,
) {
  const entry = resolve(directory, "storage-crash-worker.cjs");
  const arm = resolve(directory, "storage-crash-arm.json");
  const marker = resolve(directory, "storage-crash.json");
  await writeFile(
    entry,
    `
const {existsSync,readFileSync,writeFileSync}=require('node:fs');
const crash=${JSON.stringify(crash)},arm=${JSON.stringify(arm)},marker=${JSON.stringify(marker)};
const port=process.parentPort,on=port.on.bind(port),post=port.postMessage.bind(port);
let selected,owner;
function terminate(){
  writeFileSync(marker,JSON.stringify({...crash,pid:process.pid,parent:process.ppid}),{mode:0o600});
  if(crash.target==='main') process.kill(owner,'SIGKILL');
  process.kill(process.pid,'SIGKILL');
}
port.on=(name,listener)=>on(name,name!=='message'?listener:(event)=>{
  const message=event.data;
  if(message?.action==='write' && typeof message.key==='string' &&
    message.key.endsWith('/module-state') &&
    existsSync(arm)){
    const expected=JSON.parse(readFileSync(arm,'utf8'));
    const matches=expected.promotion
      ? !!message.value?.recoveryImports?.[expected.promotion]?.promotion
      : Object.keys(message.value?.recoveryImports??{}).length===2;
    if(matches && expected.key===message.key && Number.isInteger(expected.mainPid) && expected.mainPid===process.ppid){
      owner=expected.mainPid;
      selected=message.id;
      if(crash.phase==='before') terminate();
    }
  }
  return listener(event);
});
port.postMessage=(reply,...args)=>{
  // The production worker replies only after its real SQLite statement committed.
  if(selected!==undefined && reply.id===selected && reply.value===true && !reply.error)
    terminate();
  return post(reply,...args);
};
require(${JSON.stringify(resolve("apps/desktop/dist/cache-worker.cjs"))});
`,
    { mode: 0o600 },
  );
  return { entry, arm, marker };
}
