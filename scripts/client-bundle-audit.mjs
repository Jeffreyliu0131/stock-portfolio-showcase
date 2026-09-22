import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [".next/static", ".next-demo/static", "dist/client"].filter(existsSync);
if (roots.length === 0) {
  console.error("Client bundle audit failed: build output was not found.");
  process.exit(1);
}

function filesBelow(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

const forbiddenPatterns = [
  /appgprj_[a-f0-9]{28,32}/u,
  /DEEPSEEK_API_KEY/u,
  /OPENAI_API_KEY/u,
  /ALPACA_API_KEY_ID/u,
  /ALPACA_API_SECRET_KEY/u,
  /replace-with-your-server-only/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /AKIA[0-9A-Z]{16}/u,
  /AIza[0-9A-Za-z_-]{30,}/u,
  /sk-[A-Za-z0-9_-]{20,}/u,
  /gh[pousr]_[A-Za-z0-9]{30,}/u,
  /xox[baprs]-[A-Za-z0-9-]{20,}/u,
];

const failures = [];
let scanned = 0;
for (const root of roots) {
  for (const file of filesBelow(root)) {
    if (!statSync(file).isFile()) {
      continue;
    }
    scanned += 1;
    const content = readFileSync(file, "utf8");
    if (forbiddenPatterns.some((pattern) => pattern.test(content))) {
      failures.push(file);
    }
  }
}

if (failures.length > 0) {
  console.error(
    "Client bundle audit failed; server credential material appears in:\n" +
      failures.map((file) => `- ${file}`).join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(`Client bundle audit passed for ${scanned} built files.`);
}
