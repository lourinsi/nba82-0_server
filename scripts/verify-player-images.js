const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PLAYER_IMAGE_MAP_PATH = path.resolve(ROOT_DIR, "data", "player_image_map.json");
const REPORT_PATH = path.resolve(ROOT_DIR, "data", "player_image_report.json");
const NBA_CDN_HEADSHOT_BASE_URL = "https://cdn.nba.com/headshots/nba/latest/260x190";

function parseArgs(argv) {
  const options = {
    delayMs: 150,
    limit: null,
    reportPath: REPORT_PATH,
    timeoutMs: 5000,
    writeReport: true,
  };

  for (const arg of argv) {
    if (arg.startsWith("--delayMs=")) {
      options.delayMs = Number(arg.slice("--delayMs=".length));
    } else if (arg.startsWith("--limit=")) {
      options.limit = Number(arg.slice("--limit=".length));
    } else if (arg.startsWith("--output=")) {
      options.reportPath = path.resolve(ROOT_DIR, arg.slice("--output=".length));
    } else if (arg.startsWith("--timeoutMs=")) {
      options.timeoutMs = Number(arg.slice("--timeoutMs=".length));
    } else if (arg === "--noReport") {
      options.writeReport = false;
    }
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    options.delayMs = 150;
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    options.timeoutMs = 5000;
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    options.limit = null;
  }

  return options;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function numberOrNull(value) {
  const numeric = Number(value);

  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function getNbaCdnHeadshotUrl(nbaStatsId) {
  const id = numberOrNull(nbaStatsId);

  return id ? `${NBA_CDN_HEADSHOT_BASE_URL}/${encodeURIComponent(String(id))}.png` : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        method: "GET",
        signal: controller.signal,
      });
    }

    return {
      ok: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const imageMap = readJson(PLAYER_IMAGE_MAP_PATH);
  const entries = Object.entries(imageMap);
  const nbaCdnEntries = entries
    .map(([key, entry]) => ({
      key,
      nba_stats_id: numberOrNull(entry?.nba_stats_id),
      player: entry?.player || key,
      url: entry?.imageProvider === "nba-cdn" ? getNbaCdnHeadshotUrl(entry?.nba_stats_id) : null,
    }))
    .filter((entry) => entry.nba_stats_id && entry.url);
  const entriesToCheck = options.limit ? nbaCdnEntries.slice(0, options.limit) : nbaCdnEntries;
  const report = {
    broken: [],
    checked: 0,
    fallback_required: entries.length - nbaCdnEntries.length,
    generated_at: new Date().toISOString(),
    valid: [],
  };

  for (const entry of entriesToCheck) {
    const result = await checkUrl(entry.url, options.timeoutMs);
    const reportEntry = {
      key: entry.key,
      nba_stats_id: entry.nba_stats_id,
      player: entry.player,
      status: result.status,
      url: entry.url,
      ...(result.error ? { error: result.error } : {}),
    };

    if (result.ok) {
      report.valid.push(reportEntry);
    } else {
      report.broken.push(reportEntry);
    }

    report.checked += 1;

    if (options.delayMs && report.checked < entriesToCheck.length) {
      await sleep(options.delayMs);
    }
  }

  report.summary = {
    broken_nba_cdn_images: report.broken.length,
    checked_nba_cdn_images: report.checked,
    fallback_required: report.fallback_required,
    skipped_nba_cdn_images: nbaCdnEntries.length - entriesToCheck.length,
    total_entries: entries.length,
    valid_nba_cdn_images: report.valid.length,
  };

  if (options.writeReport) {
    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
    fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`Valid NBA CDN images: ${report.summary.valid_nba_cdn_images}`);
  console.log(`Broken NBA CDN images: ${report.summary.broken_nba_cdn_images}`);
  console.log(`Fallback required: ${report.summary.fallback_required}`);

  if (options.writeReport) {
    console.log(`Wrote image verification report to ${options.reportPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  getNbaCdnHeadshotUrl,
  main,
};
