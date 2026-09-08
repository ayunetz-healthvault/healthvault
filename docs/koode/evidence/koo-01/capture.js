const { chromium } = require('playwright');

const OUT = process.env.OUT;
const BASE = 'http://localhost:19006';
const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();

// React Native Web renders absolute pixel font sizes and ignores both the OS
// text-size setting and the browser's root font size, so "render at 200%" is
// not something this preview can do. What it *can* do is apply the same layout
// pressure from the other direction: the same text in far less width, which is
// what enlarged text does to a layout. That is what `narrow` is, and it is not
// a substitute for testing on a device with large text turned on.
const PROFILES = [
  { name: 'small', viewport: { width: 360, height: 740 } },
  { name: 'large', viewport: { width: 430, height: 932 } },
  { name: 'narrow', viewport: { width: 240, height: 740 } },
];

const CARE = [['home', '/care'], ['family', '/care/family'], ['calendar', '/care/calendar'], ['tasks', '/care/tasks']];
const ME = [['today', '/me'], ['health', '/me/health'], ['calendar', '/me/calendar'], ['family', '/me/family']];

/** Onboarding, disclaimer and demo sign-in, so the shells are reachable. */
async function enter(page) {
  await page.goto(BASE + '/care', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForTimeout(2500);
  if (page.url().includes('/onboarding')) {
    await page.getByText('Skip', { exact: false }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  if (page.url().includes('disclaimer')) {
    await tid(page, 'disclaimer-checkbox').click().catch(() => {});
    await page.waitForTimeout(400);
    await tid(page, 'disclaimer-continue').click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (page.url().includes('sign-in')) {
    await tid(page, 'sign-in-demo').click().catch(() => {});
    await page.waitForTimeout(3000);
  }
}

/** Flips the demonstration preview so the parent's own screens render. */
async function setParentPreview(page, on) {
  await page.goto(BASE + '/settings', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  const row = tid(page, 'settings-preview-parent');
  const label = await row.innerText().catch(() => '');
  const previewing = label.includes('Back to the family');
  if (previewing !== on) {
    await row.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
}

async function shoot(page, profile, prefix, routes) {
  for (const [name, route] of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `${OUT}/${profile.name}__${prefix}-${name}.png`, fullPage: true });
      console.log('ok', profile.name, prefix, name);
    } catch (error) {
      console.log('FAIL', profile.name, prefix, name, error.message.split('\n')[0]);
    }
  }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  for (const profile of PROFILES) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    await enter(page);
    await setParentPreview(page, false);
    await shoot(page, profile, 'care', CARE);

    await setParentPreview(page, true);
    await shoot(page, profile, 'me', ME);

    await context.close();
  }

  await browser.close();
})();
