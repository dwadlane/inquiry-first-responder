import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

mkdirSync('docs/screenshots', { recursive: true });
const port = 4199;
const srv = spawn('node', ['scripts/serve-demo.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const errors = [];

const toDemo = (page) => page.evaluate(() => window.scrollTo(0, document.getElementById('demo').getBoundingClientRect().top + window.scrollY - 76));

async function play(page, messages) {
  for (const m of messages) {
    await page.fill('#msg', m);
    await page.click('#send');
    await page.waitForFunction(() => !document.querySelector('.typing') && !document.getElementById('send').disabled);
  }
}

for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(url);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: `docs/screenshots/${name}-top.png` });

  await play(page, ['half my house lost power', 'Oakfield', 'asap', "I'm Sam Rivera, 555 010 2233"]);
  await toDemo(page);
  await page.screenshot({ path: `docs/screenshots/${name}-handoff.png`, fullPage: name === 'mobile' ? false : false });
  if (name === 'mobile') {
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.team').getBoundingClientRect().top + window.scrollY - 12));
    await page.screenshot({ path: `docs/screenshots/${name}-team-panel.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) errors.push('mobile: horizontal scroll');
  }

  // price question and emergency
  await page.click('#reset');
  await page.click('.chip:nth-of-type(2)');
  await page.waitForFunction(() => !document.querySelector('.typing') && !document.getElementById('send').disabled);
  await toDemo(page);
  await page.screenshot({ path: `docs/screenshots/${name}-price-question.png` });

  if (name === 'desktop') {
    await page.click('#reset');
    await page.click('#theme');
    await page.click('.chip:nth-of-type(3)');
    await page.waitForFunction(() => !document.querySelector('.typing') && !document.getElementById('send').disabled);
    await toDemo(page);
    await page.screenshot({ path: 'docs/screenshots/desktop-emergency-dark.png' });
    await page.screenshot({ path: 'docs/screenshots/desktop-full-page.png', fullPage: true });
  }
  await ctx.close();
}
await browser.close();
srv.kill();
if (errors.length) { console.error('Problems:\n' + errors.join('\n')); process.exit(1); }
console.log('Screenshots saved in docs/screenshots');
