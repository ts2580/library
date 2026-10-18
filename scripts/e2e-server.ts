import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import sharp from "sharp";
import { hashPassword } from "@/features/auth/password";
import { sqlite } from "@/db";
import { env } from "@/lib/env";

async function main() {
if (path.dirname(env.dataDir) !== tmpdir() || !path.basename(env.dataDir).startsWith("bookshelf-e2e-")) {
  throw new Error("E2E server requires an isolated temporary database.");
}

if (process.env.BOOKSHELF_E2E_SIGNUP !== "true") {
const passwordHash = await hashPassword("fixture-only-password");
sqlite.prepare("INSERT INTO member(id,username,password_hash,role) VALUES (1,'fixture-admin',?,'ADMIN'),(2,'fixture-user',?,'USER'),(3,'fixture-stock',?,'ADMIN'),(4,'fixture-book-stock',?,'ADMIN')")
  .run(passwordHash, passwordHash, passwordHash, passwordHash);
sqlite.prepare("INSERT INTO books(id,name,owner_id,cover,cover_generated) VALUES (1,'마이그레이션 테스트 책',1,'cover://1/fixture.webp',1),(2,'다른 계정 비공개 도서',2,'cover://2/fixture.webp',1)").run();
sqlite.prepare("INSERT INTO book_volumes(id,book,volume,seq,name,isbn13) VALUES(1,1,1,99,'테스트 1권','9780000000001'),(2,2,1,99,'비공개 1권','9780000000002')").run();
sqlite.prepare("INSERT INTO books(id,name,owner_id) VALUES (3,'재고 검증 전용 책',3)").run();
sqlite.prepare("INSERT INTO book_volumes(id,book,volume,name,isbn13) VALUES(3,3,1,'재고 갱신 검증 권','9780000000099')").run();
sqlite.prepare("INSERT INTO book_volumes(id,book,volume,name,isbn13,ispurchased,noneedtobuy) VALUES(4,3,2,'구매한 권','9780000000098',1,0),(5,3,3,'구매 불필요 권','9780000000097',0,1)").run();
sqlite.prepare("INSERT INTO books(id,name,owner_id) VALUES(4,'책별 재고 대상',4),(5,'책별 재고 제외',4)").run();
sqlite.prepare("INSERT INTO book_volumes(id,book,volume,name,isbn13,ispurchased) VALUES(6,4,1,'책별 재고 대상 1','9780000000111',0),(7,4,2,'책별 재고 구매한 권','9780000000112',1),(8,5,1,'다른 책 권','9780000000113',0)").run();
for (let id = 1; id <= 28; id++) sqlite.prepare("INSERT INTO branchbook(id,book,book_volume_id,volume,branch,branchname,name,price) VALUES(?,1,1,1,'SEOUL','서울점','테스트 100%_!','1,000')").run(id);
sqlite.prepare("INSERT INTO branchbook(id,book,book_volume_id,volume,branch,branchname,name,price) VALUES(29,4,6,1,'OLD','기존점','책별 기존 재고','900'),(30,5,8,1,'OTHER','다른점','다른 책 기존 재고','800'),(31,4,7,2,'OLD','기존점','구매한 권 기존 재고','700')").run();
for (const ownerId of [1, 2]) {
  const directory = path.join(env.coversDir, String(ownerId));
  mkdirSync(directory, { recursive: true });
  await sharp({ create: { width: 40, height: 60, channels: 3, background: "#586fce" } }).webp().toFile(path.join(directory, "fixture.webp"));
}
}
sqlite.close();

const web = spawn(process.execPath, ["--import", "./tests/fixtures/mock-aladin.mjs", "node_modules/next/dist/bin/next", process.env.BOOKSHELF_E2E_DEV === "true" ? "dev" : "start", "--port", "25648", "--hostname", "127.0.0.1"], { stdio: "inherit", env: process.env });
const worker = spawn(process.execPath, ["--conditions=react-server", "--import", "./tests/fixtures/mock-aladin.mjs", "--import", "tsx", "worker/worker.ts"], { stdio: "inherit", env: process.env });
let stopping = false;
function stop() { if (!stopping) { stopping = true; web.kill("SIGTERM"); worker.kill("SIGTERM"); } }
process.on("SIGTERM", stop); process.on("SIGINT", stop);
const webDone = once(web, "exit"); const workerDone = once(worker, "exit");
const [code] = await Promise.race([webDone, workerDone]);
stop(); await Promise.all([webDone, workerDone]);
if (typeof code === "number" && code !== 0) process.exitCode = code;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
