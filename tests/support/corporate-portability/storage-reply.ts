import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

/** Withhold only the acknowledgement of the selected real committed SQLite write. */
export async function storageReplyWorker(directory: string) {
  const entry = resolve(directory, "storage-reply-worker.cjs");
  const arm = resolve(directory, "storage-reply-arm.json");
  const marker = resolve(directory, "storage-reply-committed.json");
  const release = resolve(directory, "storage-reply-release");
  const delivered = resolve(directory, "storage-reply-delivered");
  await writeFile(
    entry,
    `
const {existsSync,readFileSync,writeFileSync}=require('node:fs');
const arm=${JSON.stringify(arm)},marker=${JSON.stringify(marker)};
const release=${JSON.stringify(release)},delivered=${JSON.stringify(delivered)};
const port=process.parentPort,on=port.on.bind(port),post=port.postMessage.bind(port);
let selected,held=false;
port.on=(name,listener)=>on(name,name!=='message'?listener:(event)=>{
  const message=event.data;
  if(selected===undefined && message?.action==='write' && existsSync(arm)){
    const expected=JSON.parse(readFileSync(arm,'utf8'));
    if(message.key===expected.key && expected.mainPid===process.ppid &&
      message.value?.recoveryImports?.[expected.digest]?.promotion) selected=message.id;
  }
  return listener(event);
});
port.postMessage=(reply,...args)=>{
  if(!held && selected!==undefined && reply.id===selected && reply.value===true && !reply.error){
    held=true;
    writeFileSync(marker,JSON.stringify({parent:process.ppid,pid:process.pid}),{mode:0o600});
    const timer=setInterval(()=>{
      if(!existsSync(release)) return;
      clearInterval(timer);
      post(reply,...args);
      writeFileSync(delivered,'done',{mode:0o600});
    },10);
    return;
  }
  return post(reply,...args);
};
require(${JSON.stringify(resolve("apps/desktop/dist/cache-worker.cjs"))});
`,
    { mode: 0o600 },
  );
  return {
    entry,
    arm: (key: string, digest: string, mainPid: number) =>
      writeFile(arm, JSON.stringify({ key, digest, mainPid }), { mode: 0o600 }),
    arrived: async (parent: number) => {
      await expect
        .poll(async () => {
          try {
            return JSON.parse(await readFile(marker, "utf8"));
          } catch {
            return undefined;
          }
        })
        .toMatchObject({ parent });
    },
    release: async () => {
      await writeFile(release, "release", { mode: 0o600 });
      await expect
        .poll(async () => {
          try {
            return await readFile(delivered, "utf8");
          } catch {
            return undefined;
          }
        })
        .toBe("done");
    },
  };
}
