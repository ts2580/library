import { withRequestGate } from "../../features/aladin/request-gate";
const [filename, mode] = process.argv.slice(2);
let started=0;
const spans=Array.from({length:mode==='crash'?10:6},()=>withRequestGate(filename!,20,async()=>{
  const start=Date.now();
  if(mode==='crash'){
    if(++started===10)process.stdout.write('ready\n');
    await new Promise(()=>{setInterval(()=>{},1000);});
  }
  await new Promise(resolve=>setTimeout(resolve,350));
  return {start,end:Date.now()};
}));
void Promise.all(spans).then(result=>process.stdout.write(JSON.stringify(result)));
