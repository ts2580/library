import { withRequestGate } from "../../features/aladin/request-gate";
const filename=process.argv[2]!;
void withRequestGate(filename,80,async()=>{
 const start=Date.now();
 await new Promise(r=>setTimeout(r,30));
 process.stdout.write(JSON.stringify({start,end:Date.now()}));
});
