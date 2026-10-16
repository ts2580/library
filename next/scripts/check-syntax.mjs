import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require("typescript");
} catch {
  const globalRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8" }).trim();
  ts = require(path.join(globalRoot, "typescript"));
}

const root = process.cwd();
const errors = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "legacy-java"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      const source = fs.readFileSync(target, "utf8");
      const result = ts.transpileModule(source, {
        fileName: target,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX
        },
        reportDiagnostics: true
      });
      for (const diagnostic of result.diagnostics ?? []) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        const line = diagnostic.file && diagnostic.start != null ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : null;
        errors.push(`${path.relative(root, target)}${line ? `:${line.line + 1}:${line.character + 1}` : ""} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
      }
    }
  }
}
walk(root);
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("TypeScript/TSX syntax check passed.");
