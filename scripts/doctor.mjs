async function doctor() {
  const routes = [
    { name: 'Backend Health', url: 'http://localhost:3001/api/v1/health' },
    { name: 'Backend Products API', url: 'http://localhost:3001/api/v1/products?limit=1' },
    { name: 'Backend Categories API', url: 'http://localhost:3001/api/v1/categories' },
    { name: 'Backend Communities API', url: 'http://localhost:3001/api/v1/communities' },
    { name: 'Backend Featured Coupons API', url: 'http://localhost:3001/api/v1/coupons/featured' },
    { name: 'Frontend Home (/)', url: 'http://localhost:3000/' },
    { name: 'Frontend Products (/products)', url: 'http://localhost:3000/products' },
    { name: 'Frontend Coupons (/coupons)', url: 'http://localhost:3000/coupons' },
    { name: 'Frontend Shops (/shops)', url: 'http://localhost:3000/shops' },
  ];

  console.log('====================================================');
  console.log('      VRU MARKETPLACE SYSTEM DOCTOR & HEALTH CHECK  ');
  console.log('====================================================');
  let passCount = 0;
  for (const r of routes) {
    try {
      const start = Date.now();
      const res = await fetch(r.url);
      const time = Date.now() - start;
      const ok = res.status >= 200 && res.status < 400;
      if (ok) passCount++;
      const tag = ok ? '[PASS]' : '[WARN]';
      console.log(`${tag} ${r.name.padEnd(30)} -> HTTP ${res.status} (${time}ms)`);
    } catch (e) {
      console.log(`[FAIL] ${r.name.padEnd(30)} -> Error: ${e.message}`);
    }
  }
  console.log('====================================================');
  console.log(`Result: ${passCount}/${routes.length} services verified and operational.`);
  console.log('====================================================');
}

doctor();
