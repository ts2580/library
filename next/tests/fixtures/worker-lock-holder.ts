import { acquireWorkerLock } from "../../worker/singleton";
const databasePath = process.argv[2];
if (!databasePath) throw new Error("test database path is required");
const release = acquireWorkerLock(databasePath);
process.once("exit", release);
process.send?.("locked");
setInterval(() => {}, 1000);
