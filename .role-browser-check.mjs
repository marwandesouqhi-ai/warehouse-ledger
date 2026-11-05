import puppeteer from 'puppeteer-core'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const response = await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('input', { timeout: 25000 })
  console.log(JSON.stringify({ status: response.status(), title: await page.title(), inputs: await page.evaluate(() => document.querySelectorAll('input').length), pageErrors: errors }))
  if (errors.length) process.exitCode = 1
} finally { await browser.close() }
