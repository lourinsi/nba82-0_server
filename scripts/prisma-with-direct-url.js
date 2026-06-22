const { spawnSync } = require("child_process");
const path = require("path");
require("dotenv").config({ quiet: true, override: true });

const args = process.argv.slice(2);
const directUrl = process.env.DIRECT_URL?.trim();

function hasPlaceholder(value) {
  return /\[[^\]]+\]|YOUR_DATABASE_PASSWORD|YOUR_PASSWORD/.test(value || "");
}

if (directUrl) {
  if (hasPlaceholder(directUrl)) {
    console.error("DIRECT_URL still contains placeholder text. Replace it with your real database password first.");
    process.exit(1);
  }

  process.env.DATABASE_URL = directUrl;
}

if (hasPlaceholder(process.env.DATABASE_URL)) {
  console.error("DATABASE_URL still contains placeholder text. Replace it with your real database password first.");
  process.exit(1);
}

const command = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma",
);
const result = spawnSync(command, args, {
  env: process.env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
