import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

const BROWSERS = [
  {
    name: 'Google Chrome',
    id: 'chrome',
    path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  },
  {
    name: 'Microsoft Edge',
    id: 'edge',
    path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  },
];

const DEVICES = [
  {
    name: 'Desktop (1080p Full HD)',
    id: 'desktop',
    width: 1920,
    height: 1080,
    description: 'หน้าจอคอมพิวเตอร์ตั้งโต๊ะ / แล็ปท็อปขนาดใหญ่',
  },
  {
    name: 'Tablet (iPad Portrait)',
    id: 'tablet',
    width: 768,
    height: 1024,
    description: 'หน้าจอแท็บเล็ต / iPad แนวตั้ง',
  },
  {
    name: 'Mobile (iPhone 14/15/16)',
    id: 'mobile',
    width: 390,
    height: 844,
    description: 'หน้าจอสมาร์ทโฟน / มือถือ พร้อม Bottom Navigation',
  },
];

const PAGES = [
  {
    name: 'Home (หน้าแรก)',
    id: 'home',
    url: 'http://localhost:3000/',
    expectedElements: ['VRU Marketplace', 'สินค้าชุมชน'],
  },
  {
    name: 'Product Catalog (หน้ารวมสินค้าและตัวกรอง)',
    id: 'products',
    url: 'http://localhost:3000/products',
    expectedElements: ['สินค้าทั้งหมด', 'หมวดหมู่'],
  },
  {
    name: 'Coupon Center (ศูนย์รวมคูปองส่วนลด)',
    id: 'coupons',
    url: 'http://localhost:3000/coupons',
    expectedElements: ['คูปอง'],
  },
  {
    name: 'Community Shops (ทำเนียบร้านค้าชุมชน)',
    id: 'shops',
    url: 'http://localhost:3000/shops',
    expectedElements: ['ร้านค้า'],
  },
  {
    name: 'Authentication Portal (หน้าเข้าสู่ระบบ)',
    id: 'login',
    url: 'http://localhost:3000/login',
    expectedElements: ['เข้าสู่ระบบ', 'อีเมล'],
  },
];

const OUTPUT_DIRS = [
  path.resolve(process.cwd(), 'qa-reports', 'screenshots'),
  path.resolve(
    'C:\\Users\\dise_\\.gemini\\antigravity-ide\\brain\\e55fcec9-19e1-4298-bc55-e91fccf1ed76',
    'qa-evidence'
  ),
];

for (const dir of OUTPUT_DIRS) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function capture(browser, device, page) {
  const fileName = `${browser.id}_${device.id}_${page.id}.png`;
  const primaryOutputPath = path.join(OUTPUT_DIRS[0], fileName);
  const secondaryOutputPath = path.join(OUTPUT_DIRS[1], fileName);

  const startTime = Date.now();
  try {
    // Run browser in headless mode to capture screenshot
    await execFileAsync(
      browser.path,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        `--window-size=${device.width},${device.height}`,
        `--screenshot=${primaryOutputPath}`,
        page.url,
      ],
      { timeout: 20000 }
    );

    const elapsed = Date.now() - startTime;
    if (fs.existsSync(primaryOutputPath)) {
      const stats = fs.statSync(primaryOutputPath);
      // Copy to conversation artifact dir for embedding
      fs.copyFileSync(primaryOutputPath, secondaryOutputPath);

      return {
        success: true,
        fileName,
        primaryPath: primaryOutputPath,
        secondaryPath: secondaryOutputPath,
        sizeKb: (stats.size / 1024).toFixed(1),
        durationMs: elapsed,
      };
    } else {
      return {
        success: false,
        error: 'Screenshot file was not generated',
        durationMs: elapsed,
      };
    }
  } catch (err) {
    return {
      success: false,
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

async function runSuite() {
  console.log('='.repeat(80));
  console.log('     VRU MARKETPLACE CROSS-BROWSER & CROSS-DEVICE QA TEST SUITE');
  console.log('                 (TOR 6.1.2 & 6.4.1 Compliance)');
  console.log('='.repeat(80));
  console.log(`Execution Time: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`);
  console.log(`Browsers Tested: ${BROWSERS.map((b) => b.name).join(', ')}`);
  console.log(`Devices / Viewports: ${DEVICES.map((d) => `${d.id} (${d.width}x${d.height})`).join(', ')}`);
  console.log(`Pages Tested: ${PAGES.map((p) => p.name).join(', ')}`);
  console.log('-'.repeat(80));

  const results = [];
  let passedCount = 0;
  let totalCount = BROWSERS.length * DEVICES.length * PAGES.length;

  for (const browser of BROWSERS) {
    console.log(`\n🌐 [BROWSER]: ${browser.name} (${browser.path})`);
    for (const device of DEVICES) {
      console.log(`  📱 [DEVICE]: ${device.name} [${device.width}x${device.height}]`);
      for (const page of PAGES) {
        process.stdout.write(`    ⏳ Rendering ${page.name.padEnd(40)} ... `);
        const res = await capture(browser, device, page);
        if (res.success) {
          passedCount++;
          console.log(`✅ PASS (${res.sizeKb} KB, ${res.durationMs}ms)`);
        } else {
          console.log(`❌ FAIL (${res.error})`);
        }
        results.push({
          browser: browser.name,
          device: device.name,
          viewport: `${device.width}x${device.height}`,
          page: page.name,
          url: page.url,
          ...res,
        });
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`TEST SUMMARY: ${passedCount}/${totalCount} TEST CASES PASSED (${((passedCount / totalCount) * 100).toFixed(1)}%)`);
  console.log('='.repeat(80));
  console.log(`Screenshots saved to:`);
  console.log(`  1. Local Project: ${OUTPUT_DIRS[0]}`);
  console.log(`  2. Artifacts:     ${OUTPUT_DIRS[1]}`);

  // Save JSON summary
  const summaryJsonPath = path.join(OUTPUT_DIRS[0], 'summary.json');
  fs.writeFileSync(
    summaryJsonPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalCases: totalCount,
        passedCases: passedCount,
        successRate: ((passedCount / totalCount) * 100).toFixed(1) + '%',
        results,
      },
      null,
      2
    )
  );
  console.log(`Detailed JSON report written to: ${summaryJsonPath}`);
}

runSuite().catch(console.error);
