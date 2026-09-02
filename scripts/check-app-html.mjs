import fs from "fs";

const lines = fs.readFileSync("web/static/app.js", "utf8").split("\n");
let inMain = false;
let opens = 0;
let closes = 0;
let startLine = 0;

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('class="app-main"')) {
    inMain = true;
    startLine = i + 1;
  }
  if (!inMain) continue;
  opens += (l.match(/<div[\s>]/g) || []).length;
  closes += (l.match(/<\/div>/g) || []).length;
  if (l.includes('app-footer')) break;
}

console.log({ startLine, opens, closes, delta: opens - closes });
