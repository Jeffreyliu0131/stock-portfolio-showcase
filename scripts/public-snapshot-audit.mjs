import { publicationMapping } from "./sites-source-map.mjs";
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { readRegular } from './artifact-integrity.mjs';
import { auditContent, auditPath, MAX_SCANNED_FILE_BYTES } from './public-privacy-rules.mjs';

const discoveredPaths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

// A private publication mirror may retain only its whitelisted platform overlay.
// Verify exact canonical contents before excluding that overlay from the public scan.
let mapping;
try { mapping = publicationMapping(process.cwd()); }
catch {
  // JSON/Git/filesystem errors may include private metadata or local paths.
  console.error('Public snapshot audit failed:\n- ".publication/source-map.json": invalid-publication-mapping');
  process.exit(1);
}
const paths = mapping ? mapping.files.map(file => file.path) : discoveredPaths;

const failures = [];
for (const path of new Set(paths)) {
  const fail = rule => failures.push(`${JSON.stringify(path)}: ${rule}`);
  const pathRules = auditPath(path);
  if (pathRules.length) {
    for (const rule of pathRules) fail(rule);
    continue; // A forbidden filename is sufficient; never open that local file.
  }
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) {
      fail('non-regular-source');
    } else if (stats.size > MAX_SCANNED_FILE_BYTES) {
      fail('file-exceeds-audit-limit');
    } else {
      // Scan readable byte sequences in binary files too (e.g. image metadata).
      // This does not replace visual review or a dedicated media metadata audit.
      for (const rule of auditContent(readRegular(process.cwd(), path).toString('utf8'), { path })) fail(rule);
    }
  } catch {
    fail('unreadable-source');
  }
}

let envExample = '';
try { envExample = readRegular(process.cwd(), '.env.example').toString('utf8'); }
catch { failures.push('".env.example": unreadable-source'); }
for (const name of [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ALPACA_API_KEY_ID",
  "ALPACA_API_SECRET_KEY",
]) {
  const match = envExample.match(new RegExp(`^${name}=(.*)$`, "mu"));
  if (match === null || !match[1]?.startsWith("replace-with-")) {
    failures.push(`.env.example: ${name} must contain a non-secret placeholder`);
  }
}

if (failures.length > 0) {
  console.error("Public snapshot audit failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Public snapshot audit passed for ${paths.length} publishable files.`);
}
