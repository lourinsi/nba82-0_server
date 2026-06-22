const { spawnSync } = require("child_process");
const path = require("path");
require("dotenv").config({ quiet: true, override: true });

function hasPlaceholder(value) {
  return /\[[^\]]+\]|YOUR_DATABASE_PASSWORD|YOUR_PASSWORD/.test(value || "");
}

function describeUrl(name, raw) {
  if (!raw) {
    console.log(`${name}: missing`);
    return null;
  }

  const url = new URL(raw);
  console.log(`${name}:`);
  console.log(`  user: ${url.username}`);
  console.log(`  password length: ${decodeURIComponent(url.password).length}`);
  console.log(`  host: ${url.hostname}`);
  console.log(`  port: ${url.port}`);
  console.log(`  database: ${url.pathname.replace(/^\//, "")}`);
  console.log(`  params: ${url.searchParams.toString() || "(none)"}`);
  console.log(`  has placeholders: ${hasPlaceholder(raw) ? "yes" : "no"}`);

  return url;
}

function runPrismaExecute(databaseUrl) {
  const command = path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma",
  );
  const result = spawnSync(command, ["db", "execute", "--stdin"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    input: "SELECT 1;",
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 30000,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);

  return result.status ?? 1;
}

const databaseUrl = process.env.DATABASE_URL?.trim();
const directUrl = process.env.DIRECT_URL?.trim();

console.log("Checking project .env database settings...");
describeUrl("DATABASE_URL", databaseUrl);
const direct = describeUrl("DIRECT_URL", directUrl);

if (!directUrl) {
  console.error("DIRECT_URL is required for the database check.");
  process.exit(1);
}

if (hasPlaceholder(directUrl)) {
  console.error("DIRECT_URL still contains placeholder text.");
  process.exit(1);
}

if (!direct.password) {
  console.error("DIRECT_URL has an empty password.");
  process.exit(1);
}

console.log("\nRunning SELECT 1 through DIRECT_URL...");
const exitCode = runPrismaExecute(directUrl);

if (exitCode === 0) {
  console.log("\nDatabase authentication works.");
} else {
  console.error("\nDatabase authentication failed before migrations ran.");
  console.error("That means Supabase rejected the exact DIRECT_URL from this project's .env.");
}

process.exit(exitCode);
