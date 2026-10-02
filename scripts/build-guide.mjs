// Prints docs/user-guide.html to docs/Cosmic_Playground_User_Guide.pdf with Chromium.
// Set PW_CHROMIUM_PATH to use an already-installed Chromium.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = pathToFileURL(resolve('docs/user-guide.html')).href;
const target = resolve('docs/Cosmic_Playground_User_Guide.pdf');

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH });
const page = await browser.newPage();
await page.goto(source, { waitUntil: 'load' });
await page.pdf({ path: target, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log(`Wrote ${target}`);
