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
// Scroll through the page so every scroll-triggered IntersectionObserver
// (count-ups, chart draw) fires; those write their final values permanently.
await page.evaluate(async () => {
  const step = innerHeight * 0.6;
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y); await new Promise(r => setTimeout(r, 160));
  }
  window.scrollTo(0, 0);
});
await page.addStyleTag({ content: ".reveal,.lb-row{opacity:1!important;transform:none!important}" });
await new Promise(r => setTimeout(r, 1400));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("saved", out);
