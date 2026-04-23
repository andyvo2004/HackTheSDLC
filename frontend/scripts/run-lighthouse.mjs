import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const url = process.env.LIGHTHOUSE_URL || "http://127.0.0.1:5173/pay/yoga-class";
const reportDir = path.resolve(process.cwd(), "lighthouse-report");
const reportBase = path.join(reportDir, "qpp-audit");
const jsonPath = `${reportBase}.report.json`;

const thresholds = {
  accessibility: Number(process.env.LIGHTHOUSE_MIN_ACCESSIBILITY || 0.9),
  performance: Number(process.env.LIGHTHOUSE_MIN_PERFORMANCE || 0.7),
  "best-practices": Number(process.env.LIGHTHOUSE_MIN_BEST_PRACTICES || 0.85),
  seo: Number(process.env.LIGHTHOUSE_MIN_SEO || 0.8),
};

function runLighthouse() {
  const lighthouseBin = path.resolve(process.cwd(), "node_modules/.bin/lighthouse");
  const args = [
    url,
    "--chrome-flags=--headless=new",
    "--output=html",
    "--output=json",
    `--output-path=${reportBase}`,
    "--quiet",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(lighthouseBin, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Lighthouse exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function formatScore(score) {
  return `${Math.round(score * 100)}/100`;
}

await mkdir(reportDir, { recursive: true });
await runLighthouse();

const report = JSON.parse(await readFile(jsonPath, "utf8"));
const categories = report.categories || {};
const failed = [];

for (const [category, min] of Object.entries(thresholds)) {
  const score = Number(categories[category]?.score || 0);
  if (score < min) failed.push({ category, score, min });
}

for (const [category, min] of Object.entries(thresholds)) {
  const score = Number(categories[category]?.score || 0);
  console.log(`${category}: ${formatScore(score)} (min ${formatScore(min)})`);
}

console.log(`Reports written to: ${reportDir}`);

if (failed.length > 0) {
  const details = failed
    .map((f) => `${f.category} ${formatScore(f.score)} < ${formatScore(f.min)}`)
    .join(", ");
  throw new Error(`Lighthouse thresholds failed: ${details}`);
}
