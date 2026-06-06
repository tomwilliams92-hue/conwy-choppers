import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const url = process.argv[2] || "http://localhost:4173/index.html";
const out = process.argv[3] || "shots/full.png";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
// disable the load animations so nothing is stuck at opacity:0
await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}.pcol,.st-row{opacity:1!important;transform:none!important}.season-fill{width:var(--target,0)}" });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("saved", out);
