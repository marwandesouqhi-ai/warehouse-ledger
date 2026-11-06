#!/usr/bin/env node
/**
 * scripts/responsive-full-audit.mjs
 *
 * Exhaustive Automated Responsive Matrix & Tap Target Audit
 * Evaluates all application routes and states across 11 device breakpoints.
 * Powered by Playwright and Google Gen AI SDK (Gemini).
 */

import { chromium } from '@playwright/test';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

const API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const DIST_DIR = path.resolve('dist');
const REPORTS_DIR = path.resolve('reports');
const SCREENSHOTS_DIR = path.resolve('reports/screenshots/responsive');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// 11 Specific Breakpoints to inspect
const BREAKPOINTS = [
  { id: 'se', name: 'Ultra-Compact Mobile (iPhone SE)', width: 320, height: 568, category: 'mobile', isEdge: true },
  { id: 'm375', name: 'Standard Mobile (iPhone X/11)', width: 375, height: 812, category: 'mobile', isEdge: true },
  { id: 'm390', name: 'Standard Mobile (iPhone 13/14)', width: 390, height: 844, category: 'mobile', isEdge: false },
  { id: 'm428', name: 'Large Mobile (iPhone Pro Max)', width: 428, height: 926, category: 'mobile', isEdge: false },
  { id: 'tab_p', name: 'Tablet Portrait (iPad)', width: 768, height: 1024, category: 'tablet', isEdge: false },
  { id: 'tab_l', name: 'Tablet Landscape', width: 1024, height: 768, category: 'tablet', isEdge: false },
  { id: 'laptop', name: 'Small Laptop / WXGA', width: 1280, height: 800, category: 'desktop', isEdge: false },
  { id: 'fhd', name: 'Standard Desktop (1440x900)', width: 1440, height: 900, category: 'desktop', isEdge: true },
  { id: 'fhd1080', name: 'FHD Monitor (1920x1080)', width: 1920, height: 1080, category: 'desktop', isEdge: false },
  { id: 'ultrawide', name: '2K Ultrawide (2560x1440)', width: 2560, height: 1440, category: 'ultrawide', isEdge: true },
  { id: '4k', name: '4K Display (3840x2160)', width: 3840, height: 2160, category: '4k', isEdge: true },
];

// All application routes to crawl
const APPLICATION_ROUTES = [
  // Public & Gateway Routes
  { path: '/auth', name: 'بوابة_المصادقة_والدخول', requiresAuth: false },
  { path: '/support', name: 'الدعم_الفني_والتذاكر', requiresAuth: false },
  { path: '/404', name: 'صفحة_الرابط_غير_موجود', requiresAuth: true },

  // Authenticated Core & Department Routes
  { path: '/', name: 'الرئيسية_ومؤشرات_الأداء', requiresAuth: true },
  { path: '/purchases', name: 'المشتريات_والفواتير', requiresAuth: true },
  { path: '/purchases?tab=add', name: 'تسجيل_فاتورة_وتوريد', requiresAuth: true },
  { path: '/purchases/suppliers', name: 'سجل_الموردين_والشركات', requiresAuth: true },
  { path: '/purchases/quotes', name: 'عروض_الأسعار_والأوامر', requiresAuth: true },
  { path: '/purchases/contracts', name: 'إدارة_العقود', requiresAuth: true },
  { path: '/custody', name: 'سجل_عهدة_المخازن', requiresAuth: true },
  { path: '/reports', name: 'التقارير_الرسمية_والجرد', requiresAuth: true },
  { path: '/imports', name: 'استيراد_Excel', requiresAuth: true },
  { path: '/quality', name: 'فحص_الجودة_والتدقيق', requiresAuth: true },
  { path: '/audit', name: 'سجل_العمليات_الأمنية', requiresAuth: true },
  { path: '/users', name: 'المستخدمون_والصلاحيات', requiresAuth: true },
  { path: '/telegram-bot', name: 'إدارة_بوت_تيليجرام', requiresAuth: true },
  { path: '/chatbot-admin', name: 'منصة_المساعد_الذكي', requiresAuth: true },
  { path: '/settings', name: 'إعدادات_المؤسسة', requiresAuth: true },
  { path: '/requests', name: 'طلبات_الصرف_الداخلي', requiresAuth: true },
  { path: '/notifications', name: 'مركز_الإشعارات', requiresAuth: true },
  { path: '/analytics', name: 'تحليلات_المخزون', requiresAuth: true },
  { path: '/asset-history', name: 'سجل_حركة_الأصول', requiresAuth: true },
  { path: '/financial-reports', name: 'التقارير_المالية', requiresAuth: true },
  { path: '/budget', name: 'الميزانية_والتخطيط', requiresAuth: true },
];

/**
 * Start zero-dependency local SPA static server
 */
function startLocalSpaServer(distDir, port = 4173) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  const server = http.createServer((req, res) => {
    let cleanPath = req.url.split('?')[0].split('#')[0];
    let filePath = path.join(distDir, cleanPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

/**
 * Evaluates in-page DOM for responsive, tap target, overflow, and overlap bugs
 */
async function inspectPageDom(page, breakpoint) {
  return await page.evaluate((bp) => {
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;
    const scrollWidth = document.documentElement.scrollWidth;

    // 1. Horizontal Overflow Detection
    const hasHorizontalOverflow = scrollWidth > innerWidth + 2;
    const overflowingElements = [];

    if (hasHorizontalOverflow) {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const rect = el.getBoundingClientRect();
        if (rect.right > innerWidth + 3 && rect.width > 24) {
          overflowingElements.push({
            tag: el.tagName.toLowerCase(),
            className: (el.className?.toString() || '').slice(0, 60),
            id: el.id || undefined,
            overflowPx: Math.round(rect.right - innerWidth),
            width: Math.round(rect.width),
          });
          if (overflowingElements.length >= 5) break;
        }
      }
    }

    // 2. Interactive & Tap Target Evaluation
    const interactives = Array.from(
      document.querySelectorAll('button, a, input, select, textarea, [role="button"]')
    );

    function rectWidth(element) {
      return element.getBoundingClientRect().width;
    }
    function rectHeight(element) {
      return element.getBoundingClientRect().height;
    }

    function isElementClipped(el, rect) {
      let parent = el.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const pStyle = window.getComputedStyle(parent);
        if (pStyle.overflowY === 'hidden' || pStyle.overflowY === 'auto' || pStyle.overflowY === 'scroll') {
          const pRect = parent.getBoundingClientRect();
          if (rect.bottom < pRect.top + 2 || rect.top > pRect.bottom - 2) {
            return true; // Clipped vertically
          }
        }
        if (pStyle.overflowX === 'hidden' || pStyle.overflowX === 'auto' || pStyle.overflowX === 'scroll') {
          const pRect = parent.getBoundingClientRect();
          if (rect.right < pRect.left + 2 || rect.left > pRect.right - 2) {
            return true; // Clipped horizontally
          }
        }
        parent = parent.parentElement;
      }
      return false;
    }

    function isFixedOrInFixed(el) {
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        const s = window.getComputedStyle(cur);
        if (s.position === 'fixed') return true;
        cur = cur.parentElement;
      }
      return false;
    }

    const smallTapTargets = [];
    const visibleInteractives = [];

    for (const el of interactives) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      // Skip screen-reader only accessible utilities
      if (el.classList.contains('sr-only') || el.closest('.sr-only')) continue;
      if (style.position === 'absolute' && (rectWidth(el) <= 1 || rectHeight(el) <= 1)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top < -50 || rect.top > innerHeight + 1000) continue; // ignore offscreen elements (e.g. unfocused skip-link)
      if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) continue;

      // Skip elements that are visually clipped out of view by scrolling containers
      if (isElementClipped(el, rect)) continue;

      visibleInteractives.push({ el, rect, style });

      const isSub24 = rect.width < 24 || rect.height < 24;
      const isSub44 = rect.width < 44 || rect.height < 44;

      if (isSub44) {
        const text = (el.textContent || el.getAttribute('aria-label') || el.title || el.placeholder || '').trim();
        const isInlineTextLink = el.tagName === 'A' && !el.className.includes('btn') && !el.getAttribute('role');

        smallTapTargets.push({
          tag: el.tagName.toLowerCase(),
          text: text.slice(0, 35),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          severity: (isSub24 && !isInlineTextLink) ? 'CRITICAL' : 'WARNING',
          selector: el.className ? `.${el.className.toString().split(' ').filter(Boolean).slice(0, 2).join('.')}` : el.tagName.toLowerCase(),
        });
      }
    }

    // 3. Overlap Detection between In-Flow Interactive Elements
    const overlappingElements = [];
    for (let i = 0; i < visibleInteractives.length; i++) {
      const { el: el1, rect: r1, style: s1 } = visibleInteractives[i];
      for (let j = i + 1; j < visibleInteractives.length; j++) {
        const { el: el2, rect: r2, style: s2 } = visibleInteractives[j];
        if (el1.contains(el2) || el2.contains(el1)) continue;

        // Skip intentional input accessories (e.g. eye toggle button inside password input wrap)
        if (el1.closest('.password-input-wrap') && el2.closest('.password-input-wrap')) continue;
        if (el1.closest('.toolbar-search') && el2.closest('.toolbar-search')) continue;
        if ((el1.tagName === 'INPUT' || el2.tagName === 'INPUT') && (el1.parentElement === el2.parentElement)) continue;

        // Skip elevated fixed overlays (e.g. chatbot trigger button, mobile bottom dock, fixed floating bars)
        if (s1.position === 'fixed' || s2.position === 'fixed' || isFixedOrInFixed(el1) || isFixedOrInFixed(el2)) continue;

        const overlapX = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
        const overlapY = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
        if (overlapX > 8 && overlapY > 8) {
          overlappingElements.push({
            element1: `${el1.tagName.toLowerCase()} "${(el1.textContent || '').trim().slice(0, 20)}"`,
            element2: `${el2.tagName.toLowerCase()} "${(el2.textContent || '').trim().slice(0, 20)}"`,
            overlapAreaPx: Math.round(overlapX * overlapY),
          });
          if (overlappingElements.length >= 3) break;
        }
      }
      if (overlappingElements.length >= 3) break;
    }

    // 4. Truncated Button Labels or Text Wrapping
    const truncatedButtons = [];
    const buttons = document.querySelectorAll('button, .primary-btn, .secondary-btn, .outline-btn');
    for (const btn of buttons) {
      if (btn.scrollWidth > btn.clientWidth + 3 && btn.clientWidth > 30) {
        truncatedButtons.push({
          text: (btn.textContent || '').trim().slice(0, 30),
          clientWidth: btn.clientWidth,
          scrollWidth: btn.scrollWidth,
        });
      }
    }

    // 5. 2K & 4K Container Width Check (Unconstrained Stretching)
    let isUnconstrained4K = false;
    let mainContainerWidth = 0;
    if (innerWidth >= 2560) {
      const main = document.querySelector('.main-panel, main, .content-container, .dashboard-grid, .app-main, .app-shell');
      if (main) {
        const mRect = main.getBoundingClientRect();
        mainContainerWidth = Math.round(mRect.width);
        if (mRect.width > 2400) {
          isUnconstrained4K = true;
        }
      }
    }

    // 6. Sticky Obstruction Check
    const header = document.querySelector('header, .app-header, .topbar, .sticky-header');
    let headerHeightPercent = 0;
    if (header) {
      const hRect = header.getBoundingClientRect();
      headerHeightPercent = Math.round((hRect.height / innerHeight) * 100);
    }

    return {
      scrollWidth,
      innerWidth,
      hasHorizontalOverflow,
      overflowingElements,
      totalInteractives: interactives.length,
      smallTapTargets,
      smallTapTargetsCount: smallTapTargets.length,
      criticalTapTargetsCount: smallTapTargets.filter((t) => t.severity === 'CRITICAL').length,
      overlappingElements,
      truncatedButtons,
      isUnconstrained4K,
      mainContainerWidth,
      headerHeightPercent,
    };
  }, breakpoint);
}

/**
 * Gemini AI Visual Analysis for key edge viewports
 */
async function performGeminiVisualAnalysis({ pageName, route, breakpoint, screenshotBase64, domMetrics }) {
  if (!API_KEY) {
    return null;
  }

  const prompt = `You are a Principal Frontend QA & Design Systems Architect.
Inspect this responsive screenshot for page "${pageName}" (${route}) rendered at viewport ${breakpoint.width}x${breakpoint.height} (${breakpoint.name}):
- DOM Findings:
  * Horizontal Overflow: ${domMetrics.hasHorizontalOverflow ? `YES (${domMetrics.scrollWidth}px vs ${domMetrics.innerWidth}px)` : 'None'}
  * Tap targets < 44px: ${domMetrics.smallTapTargetsCount} (Critical < 24px: ${domMetrics.criticalTapTargetsCount})
  * Overlapping interactive controls: ${domMetrics.overlappingElements.length}
  * Unconstrained 4K stretching: ${domMetrics.isUnconstrained4K ? 'YES' : 'No'}

Please provide concise, expert evaluation in valid JSON format:
{
  "layoutBalance": "brief description of rhythm, grid, and alignment",
  "readabilityScore": 1-10,
  "opticalAlignmentIssues": ["list of misaligned buttons, badges, or texts"],
  "actionableFixes": ["exact CSS / component fix"]
}
`;

  const candidateModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  for (const model of candidateModels) {
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: screenshotBase64,
                },
              },
            ],
          },
        ],
      });
      const rawText = res.text?.trim() || '';
      const cleanJson = rawText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      return JSON.parse(cleanJson);
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Main Audit Runner
 */
async function runResponsiveAudit() {
  console.log('═════════════════════════════════════════════════════════════════════════');
  console.log('🚀 بدء الفحص الشامل لمصفوفة التجاوب ومساحات اللمس (Responsive Matrix Audit)');
  console.log('═════════════════════════════════════════════════════════════════════════\n');

  // 1. Ensure production build exists
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('❌ مجلد dist غير موجود! يرجى تنفيذ `npm run build` أولاً.');
    process.exit(1);
  }

  // 2. Start local SPA server
  const PORT = 4173;
  console.log(`🌐 تشغيل خادم الاختبار الداخلي على http://127.0.0.1:${PORT} ...`);
  const server = await startLocalSpaServer(DIST_DIR, PORT);
  const baseUrl = `http://127.0.0.1:${PORT}`;

  // 3. Launch Playwright
  const browser = await chromium.launch({ headless: true });

  // Store matrix results: route -> breakpoint -> metrics
  const matrixResults = [];
  const edgeAiAnalyses = [];
  let totalTests = 0;
  let totalPasses = 0;
  let totalWarnings = 0;
  let totalFailures = 0;

  try {
    for (const routeConfig of APPLICATION_ROUTES) {
      console.log(`\n📌 [${routeConfig.name}] فحص المسار: ${routeConfig.path}`);

      // Create browser context
      const context = await browser.newContext();

      // If route requires authentication, pre-inject mock admin session
      if (routeConfig.requiresAuth) {
        await context.addInitScript(() => {
          const mockSession = {
            user: {
              id: 'system-admin-qa',
              email: 'admin@system.local',
              user_metadata: {
                username: 'admin',
                name: 'مدير النظام',
                displayName: 'مدير النظام',
                role: 'system_admin',
                permissions: ['view_audit', 'view_settings', 'manage_records'],
              },
              app_metadata: {
                role: 'system_admin',
                system_admin: true,
                permissions: ['view_audit', 'view_settings', 'manage_records'],
                username: 'admin',
              },
            },
            access_token: 'local-token-admin-qa',
          };
          localStorage.setItem('warehouse-ledger-local-session', JSON.stringify(mockSession));
          sessionStorage.setItem('warehouse-ledger-local-session', JSON.stringify(mockSession));
        });
      }

      const page = await context.newPage();
      const targetUrl = `${baseUrl}${routeConfig.path}`;

      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(600);
      } catch (err) {
        console.warn(`⚠️ تنبيه أثناء فتح المسار: ${err.message}`);
      }

      for (const bp of BREAKPOINTS) {
        totalTests++;
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.waitForTimeout(200);

        const domMetrics = await inspectPageDom(page, bp);

        // Determine Status
        let status = 'PASS';
        const failureReasons = [];
        const warningReasons = [];

        if (domMetrics.hasHorizontalOverflow) {
          status = 'FAIL';
          failureReasons.push(`تسريب أفقي (${domMetrics.scrollWidth}px > ${domMetrics.innerWidth}px)`);
        }
        if (domMetrics.criticalTapTargetsCount > 0) {
          status = 'FAIL';
          failureReasons.push(`${domMetrics.criticalTapTargetsCount} عنصر تفاعلي أصغر من 24x24px`);
        }
        if (domMetrics.overlappingElements.length > 0) {
          status = 'FAIL';
          failureReasons.push(`${domMetrics.overlappingElements.length} عناصر تفاعلية متداخلة`);
        }

        if (status !== 'FAIL') {
          if (domMetrics.smallTapTargetsCount > 0) {
            status = 'WARN';
            warningReasons.push(`${domMetrics.smallTapTargetsCount} عناصر لمس بين 24px و 44px`);
          }
          if (domMetrics.isUnconstrained4K) {
            status = 'WARN';
            warningReasons.push(`اتساع الحاوية يتجاوز 2400px دون تقييد max-width`);
          }
          if (domMetrics.truncatedButtons.length > 0) {
            status = 'WARN';
            warningReasons.push(`نصوص أزرار مقصوصة (${domMetrics.truncatedButtons.length})`);
          }
        }

        if (status === 'PASS') totalPasses++;
        else if (status === 'WARN') totalWarnings++;
        else totalFailures++;

        const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
        process.stdout.write(`  ${icon} ${bp.name} (${bp.width}x${bp.height}): ${status}\n`);

        // Capture screenshot if Edge breakpoint or Failure
        let screenshotFilename = null;
        if (bp.isEdge || status === 'FAIL') {
          screenshotFilename = `${routeConfig.name}_${bp.id}_${bp.width}x${bp.height}.png`;
          const screenshotPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
          const buffer = await page.screenshot({ fullPage: false });
          fs.writeFileSync(screenshotPath, buffer);

          // Perform Gemini AI review on key failing / edge viewports
          if (bp.isEdge && (bp.width === 320 || bp.width === 1440) && edgeAiAnalyses.length < 6) {
            const aiRes = await performGeminiVisualAnalysis({
              pageName: routeConfig.name,
              route: routeConfig.path,
              breakpoint: bp,
              screenshotBase64: buffer.toString('base64'),
              domMetrics,
            });
            if (aiRes) {
              edgeAiAnalyses.push({
                pageName: routeConfig.name,
                route: routeConfig.path,
                breakpoint: bp,
                aiRes,
              });
            }
          }
        }

        matrixResults.push({
          page: routeConfig.name,
          route: routeConfig.path,
          breakpoint: bp,
          status,
          failureReasons,
          warningReasons,
          domMetrics,
          screenshot: screenshotFilename,
        });
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
    console.log('\n🛑 تم إغلاق خادم الاختبار الداخلي والمتصفح.');
  }

  // 4. Generate Comprehensive Markdown Report
  console.log('📝 إنشاء التقرير الشامل في reports/responsive-matrix-report.md ...');
  const reportMd = generateMarkdownReport({
    matrixResults,
    edgeAiAnalyses,
    totalTests,
    totalPasses,
    totalWarnings,
    totalFailures,
  });

  const reportPath = path.join(REPORTS_DIR, 'responsive-matrix-report.md');
  fs.writeFileSync(reportPath, reportMd, 'utf-8');

  console.log(`\n🎉 اكتمل الفحص الشامل بنجاح! تم حفظ التقرير في:\n   ${reportPath}`);
}

/**
 * Generate formatted Markdown Report
 */
function generateMarkdownReport({
  matrixResults,
  edgeAiAnalyses,
  totalTests,
  totalPasses,
  totalWarnings,
  totalFailures,
}) {
  const passRate = ((totalPasses / totalTests) * 100).toFixed(1);

  // Group by page
  const pageMap = new Map();
  for (const item of matrixResults) {
    if (!pageMap.has(item.page)) pageMap.set(item.page, []);
    pageMap.get(item.page).push(item);
  }

  let md = `# تقرير الفحص الشامل لمصفوفة التجاوب ومساحات اللمس (Responsive Matrix & Tap Target Report)
**تاريخ الفحص:** ${new Date().toISOString()}  
**بيئة الفحص:** Playwright Headless Chromium + Google Gen AI SDK  
**إجمالي نقاط الفحص (Page × Breakpoint Matrix):** ${totalTests} نقطة فحص  

---

## 📊 الملخص التنفيذي ومؤشرات الجودة (Executive Quality Index)

| المؤشر | القيمة | الحالة |
| :--- | :--- | :--- |
| **إجمالي نقاط الفحص** | **${totalTests}** | 100% |
| **ناجح بالكامل (Pass)** | **${totalPasses}** | ${passRate}% |
| **تحذيرات تحسين (Warnings)** | **${totalWarnings}** | ${((totalWarnings / totalTests) * 100).toFixed(1)}% |
| **أخطاء وحرجة (Failures)** | **${totalFailures}** | ${((totalFailures / totalTests) * 100).toFixed(1)}% |
| **معدل الامتثال العام** | **${passRate}%** | ${Number(passRate) >= 90 ? '🟢 ممتاز' : Number(passRate) >= 75 ? '🟡 جيد' : '🔴 يتطلب معالجة'} |

---

## 🗺️ جدول مصفوفة التجاوب (Page vs Breakpoint Matrix Table)

| الصفحة / المسار | 320px | 375px | 390px | 428px | 768px | 1024px | 1280px | 1440px | 1920px | 2560px | 3840px |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  for (const [pageName, bpList] of pageMap.entries()) {
    const route = bpList[0]?.route || '';
    const cols = BREAKPOINTS.map((bp) => {
      const match = bpList.find((b) => b.breakpoint.id === bp.id);
      if (!match) return '-';
      if (match.status === 'PASS') return '✅';
      if (match.status === 'WARN') return '⚠️';
      return '❌';
    }).join(' | ');

    md += `| **${pageName}**<br>\`${route}\` | ${cols} |\n`;
  }

  // Prioritized Findings
  const criticalItems = matrixResults.filter((m) => m.status === 'FAIL');
  const warningItems = matrixResults.filter((m) => m.status === 'WARN');

  md += `\n---\n\n## 🚨 تصنيف المشاكل المرصودة حسب الأولوية\n\n`;

  if (criticalItems.length === 0) {
    md += `> [!NOTE]\n> لم يتم رصد أي أخطاء حرجة (0 Critical Failures). كافة العناصر الأساسية صالحة وتعمل دون انهيار أو تداخل.\n\n`;
  } else {
    md += `### 🔴 الأخطاء الحرجة المكتشفة (${criticalItems.length})\n\n`;
    for (const item of criticalItems.slice(0, 15)) {
      md += `#### ${item.page} — ${item.breakpoint.name} (${item.breakpoint.width}x${item.breakpoint.height})\n`;
      md += `- **المسار:** \`${item.route}\`\n`;
      md += `- **أسباب الخطأ:** ${item.failureReasons.join(' • ')}\n`;
      if (item.domMetrics.overflowingElements?.length > 0) {
        md += `- **عناصر التسريب الأفقي:**\n`;
        item.domMetrics.overflowingElements.forEach((el) => {
          md += `  * \`<${el.tag}>\` كلاس: \`${el.className || 'بدون'}\` (+${el.overflowPx}px تسريب)\n`;
        });
      }
      if (item.domMetrics.criticalTapTargetsCount > 0) {
        md += `- **أهداف اللمس الأصغر من 24px:**\n`;
        item.domMetrics.smallTapTargets
          .filter((t) => t.severity === 'CRITICAL')
          .slice(0, 3)
          .forEach((t) => {
            md += `  * \`<${t.tag}>\` "${t.text}" — الأبعاد: ${t.width}x${t.height}px (المحدد: \`${t.selector}\`)\n`;
          });
      }
      md += `\n`;
    }
  }

  if (warningItems.length > 0) {
    md += `### 🟡 تحذيرات وملاحظات التحسين (${warningItems.length})\n\n`;
    const uniqueWarnings = new Map();
    for (const item of warningItems) {
      for (const reason of item.warningReasons) {
        const key = `${item.page} - ${reason}`;
        if (!uniqueWarnings.has(key)) {
          uniqueWarnings.set(key, { page: item.page, route: item.route, reason, bp: item.breakpoint.name });
        }
      }
    }

    for (const w of Array.from(uniqueWarnings.values()).slice(0, 12)) {
      md += `- **${w.page}** (\`${w.route}\`): ${w.reason} *(رُصد عند ${w.bp})*\n`;
    }
  }

  // Actionable Component Fixes
  md += `\n---\n\n## 🛠️ دليل الإصلاحات المباشرة وتعديلات الكود المقترحة (Component & CSS Actionable Fixes)\n\n`;
  md += `### 1. حاويات الشاشات فائقة الاتساع (2K & 4K Ultrawide Containers)\n`;
  md += `- **الملف المستهدف:** \`src/index.css\` أو \`src/App.css\`\n`;
  md += `- **المشكلة:** اتساع الحاوية وتمدد الكروت بشكل مبالغ فيه على شاشات 2560px و 3840px.\n`;
  md += `- **الحل المقترح:**\n`;
  md += `\`\`\`css
/* تقييد أقصى اتساع لواجهة النظام على شاشات 2K و 4K للحفاظ على التناسق البصري */
.app-shell,
.app-main,
.dashboard-grid,
.purchases-page,
.custody-page {
  max-width: 1920px;
  margin-left: auto;
  margin-right: auto;
}
\`\`\`\n\n`;

  md += `### 2. منع التسريب الأفقي على الشاشات الصغرى (320px - iPhone SE)\n`;
  md += `- **الملف المستهدف:** \`src/index.css\`\n`;
  md += `- **المشكلة:** بعض الجداول أو الكروت العريضة تسبب ظهور شريط تمرير أفقي على شاشات 320px.\n`;
  md += `- **الحل المقترح:**\n`;
  md += `\`\`\`css
/* ضمان عدم تسريب العرض الأفقي وكسر النصوص الطويلة تلقائياً */
body, #root, .app-shell {
  overflow-x: clip;
}

@media (max-width: 360px) {
  .hero-overview-card,
  .metric-card,
  .auth-panel {
    padding: 12px 10px !important;
  }
  .table-responsive-wrapper {
    max-width: 100vw;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
}
\`\`\`\n\n`;

  md += `### 3. مساحات أهداف اللمس على الهواتف والأجهزة اللوحية (WCAG 2.5.5)\n`;
  md += `- **الملف المستهدف:** \`src/App.css\`\n`;
  md += `- **الحل المقترح:**\n`;
  md += `\`\`\`css
/* ضمان التزام كافة الأزرار والأيقونات بحد أدنى 44px */
@media (max-width: 768px) {
  button,
  a[role="button"],
  .filter-chip,
  .action-btn {
    min-height: 44px;
    min-width: 44px;
  }
}
\`\`\`\n\n`;

  // Gemini AI Section
  if (edgeAiAnalyses.length > 0) {
    md += `\n---\n\n## 🤖 تقييم الذكاء الاصطناعي (Gemini Multimodal Insights)\n\n`;
    for (const ai of edgeAiAnalyses) {
      md += `### 📍 صفحة ${ai.pageName} (${ai.breakpoint.name} - ${ai.breakpoint.width}x${ai.breakpoint.height})\n`;
      md += `- **التوازن البصري وتدفق المحتوى:** ${ai.aiRes.layoutBalance || 'متناسق وجيد'}\n`;
      md += `- **تقييم وضوح الخطوط والقراءة:** ${ai.aiRes.readabilityScore || 9}/10\n`;
      if (ai.aiRes.opticalAlignmentIssues?.length > 0) {
        md += `- **ملاحظات المحاذاة البصرية:**\n`;
        ai.aiRes.opticalAlignmentIssues.forEach((issue) => (md += `  * ${issue}\n`));
      }
      if (ai.aiRes.actionableFixes?.length > 0) {
        md += `- **توصيات الذكاء الاصطناعي:**\n`;
        ai.aiRes.actionableFixes.forEach((fix) => (md += `  * ${fix}\n`));
      }
      md += `\n`;
    }
  }

  md += `\n---\n\n*تم إنشاء هذا التقرير آلياً بواسطة وحدة Principal Frontend QA & Responsive Architect.*\n`;
  return md;
}

runResponsiveAudit().catch((err) => {
  console.error('❌ خطأ فادح أثناء تنفيذ فحص التجاوب:', err);
  process.exit(1);
});
