const fs = require("node:fs");
const path = require("node:path");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY wajib diisi pada build environment.");
}

const configPath = path.join(__dirname, "..", "frontend", "js", "config.js");
const config = `window.ARMATURE_CONFIG = ${JSON.stringify({
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: key,
}, null, 2)};\n`;

fs.writeFileSync(configPath, config, "utf8");
console.log("Generated frontend/js/config.js from build environment variables.");
