import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const workerEntry = path.resolve(rootDir, ".output/public/_worker.js/index.js");
const outputPublicDir = path.resolve(rootDir, ".output/public");
const outputIndexHtml = path.resolve(outputPublicDir, "index.html");
const outputRedirects = path.resolve(outputPublicDir, "_redirects");
const publicIndexHtml = path.resolve(rootDir, "public/index.html");

async function main() {
  console.log("[build:post] Generating Cloudflare Pages SPA fallback index.html...");
  
  if (!fs.existsSync(workerEntry)) {
    console.error("[build:post] Worker entry not found:", workerEntry);
    process.exit(1);
  }

  try {
    const workerModule = await import(pathToFileURL(workerEntry).href);
    const worker = workerModule.default;
    
    // Fetch root route from worker
    const req = new Request("http://localhost/");
    const res = await worker.fetch(req, {}, { waitUntil: () => {} });
    
    if (!res.ok) {
      throw new Error(`Worker returned status ${res.status}`);
    }
    
    const html = await res.text();
    
    // Write to .output/public/index.html
    fs.writeFileSync(outputIndexHtml, html, "utf-8");
    console.log(`[build:post] Wrote .output/public/index.html (${html.length} bytes)`);
    
    // Also save to public/index.html so it persists for future builds
    fs.writeFileSync(publicIndexHtml, html, "utf-8");
    console.log(`[build:post] Wrote public/index.html`);
    
    // Ensure _redirects exists in .output/public
    fs.writeFileSync(outputRedirects, "/* /index.html 200\n", "utf-8");
    console.log(`[build:post] Wrote .output/public/_redirects`);

    console.log("[build:post] SPA fallback generation complete!");
  } catch (err) {
    console.error("[build:post] Failed to generate index.html:", err);
    process.exit(1);
  }
}

main();
