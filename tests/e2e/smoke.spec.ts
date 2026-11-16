import { expect, test } from '@playwright/test'

test.describe('signed-out smoke', () => {
  test('login asks for an e-mail address and a password', async ({ page }) => {
    await page.goto('/')
    const email = page.getByLabel('البريد الإلكتروني')
    await expect(email).toBeVisible()
    await expect(email).toHaveAttribute('type', 'email')
    await expect(page.getByLabel('كلمة المرور')).toBeVisible()
  })

  test('a username is not accepted as an identifier', async ({ page }) => {
    await page.goto('/')
    const email = page.getByLabel('البريد الإلكتروني')
    await email.fill('someuser')
    expect(await email.evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false)
  })

  test('the login page never scrolls horizontally', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
  })

  test('protected routes do not leak data when signed out', async ({ page }) => {
    await page.goto('/custody')
    await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible()
    await expect(page.getByText('عهدة المخازن والأصول التخصصية')).toHaveCount(0)
  })
})
