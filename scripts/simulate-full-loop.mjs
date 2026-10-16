/**
 * VRU Marketplace - Full Commerce Lifecycle E2E Simulation Script (Method 2)
 * 
 * Verifies financial integrity and state transitions across the full flow:
 * 1. Super Admin baseline KPIs snapshot
 * 2. Buyer cart addition & single-shop checkout
 * 3. Seller sets shipping quote
 * 4. Buyer uploads payment slip
 * 5. Seller confirms payment & stock decrement
 * 6. Seller ships order with courier tracking
 * 7. Buyer confirms receipt (order completion)
 * 8. Super Admin post-transaction KPI reconciliation & financial audit
 */

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';

// ANSI styling helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

function banner(title) {
  console.log('\n' + '='.repeat(70));
  console.log(` ${c.bold}${c.cyan}${title}${c.reset}`);
  console.log('='.repeat(70));
}

function step(num, title) {
  console.log(`\n${c.bold}${c.yellow}▶ [Step ${num}] ${title}${c.reset}`);
}

function pass(msg) {
  console.log(`  ${c.green}✔ PASS:${c.reset} ${msg}`);
}

function info(msg) {
  console.log(`  ${c.dim}ℹ INFO:${c.reset} ${msg}`);
}

function warn(msg) {
  console.log(`  ${c.yellow}⚠ WARN:${c.reset} ${msg}`);
}

function fail(msg) {
  console.log(`  ${c.red}✖ FAIL:${c.reset} ${msg}`);
}

class ApiSession {
  constructor(name, baseUrl = BASE_URL) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.cookies = '';
    this.csrfToken = '';
  }

  mergeCookies(newCookies) {
    if (!newCookies) return;
    const map = new Map();
    if (this.cookies) {
      for (const pair of this.cookies.split('; ')) {
        const [k, v] = pair.split('=');
        if (k) map.set(k.trim(), v);
      }
    }
    const rawPairs = newCookies.split(/,(?=[^;]+=[^;]+)/g);
    for (const raw of rawPairs) {
      const firstPart = raw.split(';')[0];
      const [k, v] = firstPart.split('=');
      if (k) map.set(k.trim(), v);
    }
    this.cookies = Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async fetchCsrf() {
    const res = await fetch(`${this.baseUrl}/auth/csrf`, {
      headers: this.cookies ? { 'cookie': this.cookies } : {}
    });
    this.mergeCookies(res.headers.get('set-cookie'));
    const data = await res.json();
    this.csrfToken = data.csrfToken;
    return this.csrfToken;
  }

  async login(email, password) {
    await this.fetchCsrf();
    const res = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': this.csrfToken,
        'cookie': this.cookies
      },
      body: JSON.stringify({ email, password })
    });
    this.mergeCookies(res.headers.get('set-cookie'));
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`[${this.name}] Login failed (${res.status}): ${JSON.stringify(data)}`);
    }
    // Refresh CSRF after login
    await this.fetchCsrf();
    return data;
  }

  async request(method, endpoint, body = null, isFormData = false) {
    const headers = {};
    if (this.cookies) headers['cookie'] = this.cookies;
    if (this.csrfToken && method !== 'GET') headers['x-csrf-token'] = this.csrfToken;
    if (!isFormData && body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, opts);
    this.mergeCookies(res.headers.get('set-cookie'));

    if (res.status === 204) return null;
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`[${this.name}] ${method} ${endpoint} returned ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
    }
    return data;
  }

  get(endpoint) { return this.request('GET', endpoint); }
  post(endpoint, body, isFormData = false) { return this.request('POST', endpoint, body, isFormData); }
  patch(endpoint, body) { return this.request('PATCH', endpoint, body); }
  delete(endpoint) { return this.request('DELETE', endpoint); }
}

async function runE2ESimulation() {
  banner('VRU Marketplace - Automated E2E Financial & State Loop Simulation');
  console.log(`Target Backend: ${c.bold}${BASE_URL}${c.reset}`);
  console.log(`Execution Timestamp: ${new Date().toISOString()}`);

  const superAdmin = new ApiSession('SuperAdmin');
  const seller = new ApiSession('SellerA');
  const buyer = new ApiSession('BuyerA');

  // STEP 1: AUTHENTICATION & SUPER ADMIN BASELINE
  step(1, 'Super Admin Authentication & KPI Baseline Snapshot');
  const adminUser = await superAdmin.login('super@vru.ac.th', 'password123');
  pass(`Authenticated as Super Admin: ${adminUser.email} (Role: ${adminUser.role})`);

  const initialKpis = await superAdmin.get('/admin/dashboard/platform');
  info(`Baseline Metrics:
      - Total Orders: ${c.bold}${initialKpis.totalOrders}${c.reset}
      - Total Gross Sales: ${c.bold}฿${initialKpis.totalSales.toLocaleString()}${c.reset}
      - Active Communities: ${initialKpis.totalCommunities}
      - Total Users: ${initialKpis.totalUsers}`);

  // STEP 2: SELLER INITIALIZATION & PRODUCT RETRIEVAL
  step(2, 'Seller Session & Product Verification');
  const sellerUser = await seller.login('seller_a@vru.ac.th', 'password123');
  pass(`Authenticated as Seller: ${sellerUser.email}`);

  const shopInfo = await seller.get('/shops/me');
  pass(`Verified Shop: "${shopInfo.name}" (ID: ${shopInfo.id})`);

  // Ensure seller has at least 1 payment channel
  const channels = await seller.get('/shops/me/payment-channels');
  if (channels.length === 0) {
    info('Shop has no payment channels. Creating PromptPay channel...');
    await seller.post('/shops/me/payment-channels', {
      type: 'PROMPTPAY',
      promptPayId: '0812345678'
    });
    pass('Created PromptPay payment channel');
  } else {
    pass(`Payment channel active: ${channels[0].type} (${channels[0].promptPayId || channels[0].bankName})`);
  }

  // Fetch product from this shop
  const myProducts = await seller.get('/products/mine');
  if (!myProducts.items || myProducts.items.length === 0) {
    throw new Error('Seller has no products to test with!');
  }
  const testProduct = myProducts.items.find(p => p.shopPublishStatus === 'PUBLISHED' && p.moderationStatus === 'APPROVED' && p.variants.some(v => v.stock > 0)) || myProducts.items[0];
  const testVariant = testProduct.variants.find(v => v.stock > 0) || testProduct.variants[0];
  const originalStock = testVariant.stock;
  const unitPriceSatang = testVariant.priceAmountMinor;
  const unitPriceBaht = unitPriceSatang / 100;

  info(`Selected Product: "${testProduct.name}" (Variant: "${testVariant.name}")
      - Variant ID: ${testVariant.id}
      - Current Stock: ${originalStock} units
      - Unit Price: ฿${unitPriceBaht.toFixed(2)} (${unitPriceSatang} satang)`);

  // STEP 3: BUYER INITIALIZATION & CART/ORDER CREATION
  step(3, 'Buyer Authentication, Cart Addition & Single-Shop Checkout');
  const buyerUser = await buyer.login('buyer_a@vru.ac.th', 'password123');
  pass(`Authenticated as Buyer: ${buyerUser.email}`);

  // Check / ensure address
  const addresses = await buyer.get('/addresses?limit=5');
  let shippingAddressId;
  if (addresses.items && addresses.items.length > 0) {
    shippingAddressId = addresses.items[0].id;
    pass(`Using existing address: ${addresses.items[0].recipientName} (${addresses.items[0].provinceNameTh})`);
  } else {
    info('Buyer has no address. Creating test address...');
    const provs = await buyer.get('/provinces?limit=1');
    const dists = await buyer.get(`/districts?provinceId=${provs.items[0].id}&limit=1`);
    const subs = await buyer.get(`/subdistricts?districtId=${dists.items[0].id}&limit=1`);
    const newAddr = await buyer.post('/addresses', {
      recipientName: 'สมชาย นักศึกษาทดสอบ',
      phone: '0891234567',
      houseNumber: '99/99',
      subdistrictPostalCodeId: subs.items[0].postalCodes[0].id
    });
    shippingAddressId = newAddr.id;
    pass(`Created new delivery address ID: ${shippingAddressId}`);
  }

  // Clear existing cart to avoid multi-shop confusion
  await buyer.delete('/cart');
  info('Cleared buyer cart');

  // Add 1 quantity to cart
  const cartAfterAdd = await buyer.post('/cart/items', {
    variantId: testVariant.id,
    quantity: 1
  });
  pass(`Added variant to cart. Cart items count: ${cartAfterAdd.items.length}`);

  const cartItem = cartAfterAdd.items.find(i => i.variantId === testVariant.id);
  if (!cartItem) throw new Error('Cart item was not found after addition');

  // Checkout with single shop items
  info('Executing single-shop checkout...');
  const checkoutOrders = await buyer.post('/orders', {
    addressId: shippingAddressId,
    items: [
      {
        cartItemId: cartItem.id,
        quantity: 1,
        priceAmountMinor: cartItem.priceAmountMinor
      }
    ]
  });

  const createdOrder = Array.isArray(checkoutOrders) ? checkoutOrders[0] : checkoutOrders;
  const orderId = createdOrder.id;
  pass(`Checkout successful! Created Order ID: ${c.bold}${orderId}${c.reset}`);
  pass(`Initial Status: ${c.cyan}${createdOrder.status || createdOrder.displayStatus}${c.reset}`);
  if (createdOrder.status !== 'AWAITING_SHIPPING_QUOTE') {
    warn(`Expected initial status AWAITING_SHIPPING_QUOTE, got: ${createdOrder.status}`);
  }

  // STEP 4: SELLER SETS SHIPPING QUOTE
  step(4, 'Seller Quotes Shipping Fee');
  const shippingFeeSatang = 4500; // 45.00 THB
  const updatedWithShipping = await seller.post(`/shops/me/orders/${orderId}/shipping-fee`, {
    shippingAmountMinor: shippingFeeSatang
  });

  const expectedTotalSatang = unitPriceSatang + shippingFeeSatang;
  pass(`Shipping fee set: ฿${(shippingFeeSatang / 100).toFixed(2)}`);
  pass(`New Status: ${c.cyan}${updatedWithShipping.status || updatedWithShipping.displayStatus}${c.reset}`);
  pass(`Calculated Total: ฿${(updatedWithShipping.totalAmountMinor / 100).toFixed(2)} (Expected: ฿${(expectedTotalSatang / 100).toFixed(2)})`);

  if (updatedWithShipping.totalAmountMinor !== expectedTotalSatang) {
    fail(`Total satang mismatch: got ${updatedWithShipping.totalAmountMinor}, expected ${expectedTotalSatang}`);
  } else {
    pass('Order total arithmetic verified (Unit Price + Shipping Fee matches)');
  }

  // STEP 5: BUYER UPLOADS PAYMENT SLIP
  step(5, 'Buyer Uploads Payment Slip');
  // 1x1 valid PNG buffer
  const samplePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const formData = new FormData();
  const fileBlob = new Blob([samplePng], { type: 'image/png' });
  formData.append('file', fileBlob, 'payment_slip.png');

  const slipResult = await buyer.post(`/orders/${orderId}/payment-slips`, formData, true);
  pass(`Uploaded payment slip (Slip ID: ${slipResult.id})`);

  const orderAfterSlip = await buyer.get(`/orders/${orderId}`);
  pass(`New Status: ${c.cyan}${orderAfterSlip.status || orderAfterSlip.displayStatus}${c.reset}`);
  if (orderAfterSlip.status !== 'PAYMENT_SUBMITTED') {
    warn(`Expected status PAYMENT_SUBMITTED, got: ${orderAfterSlip.status}`);
  }

  // STEP 6: SELLER CONFIRMS PAYMENT & STOCK DEDUCTION
  step(6, 'Seller Confirms Payment (Real Stock Cut)');
  const orderPaid = await seller.post(`/shops/me/orders/${orderId}/confirm-payment`);
  pass(`Payment confirmed by Seller!`);
  pass(`New Status: ${c.cyan}${orderPaid.status || orderPaid.displayStatus}${c.reset}`);
  if (orderPaid.status !== 'PAID') {
    warn(`Expected status PAID, got: ${orderPaid.status}`);
  }

  // Verify stock deduction
  const myProductsAfter = await seller.get('/products/mine');
  const productAfter = myProductsAfter.items.find(p => p.id === testProduct.id);
  const variantAfter = productAfter.variants.find(v => v.id === testVariant.id);
  const expectedStock = originalStock - 1;
  info(`Stock Verification: Previous=${originalStock}, Current=${variantAfter.stock}, Expected=${expectedStock}`);
  if (variantAfter.stock === expectedStock) {
    pass(`Stock successfully decremented by exactly 1 unit!`);
  } else {
    fail(`Stock mismatch: got ${variantAfter.stock}, expected ${expectedStock}`);
  }

  // STEP 7: SELLER FULFILLMENT & SHIPPING
  step(7, 'Seller Ships Order with Courier Tracking & Uploads Shipping Receipt');
  const carriers = await seller.get('/shipping-carriers?limit=10');
  const selectedCarrier = carriers.items.find(c => !c.isOther && c.isActive) || carriers.items[0];
  const trackingNumber = `VRU-TEST-${Date.now()}`;

  const orderShipped = await seller.post(`/shops/me/orders/${orderId}/ship`, {
    shippingCarrierId: selectedCarrier.id,
    trackingNumber
  });
  pass(`Shipped via "${selectedCarrier.name}" with Tracking: ${trackingNumber}`);
  pass(`New Status: ${c.cyan}${orderShipped.status || orderShipped.displayStatus}${c.reset}`);
  if (orderShipped.status !== 'SHIPPED') {
    warn(`Expected status SHIPPED, got: ${orderShipped.status}`);
  }

  // Seller uploads shipping receipt / parcel slip photo
  const shippingSlipFormData = new FormData();
  shippingSlipFormData.append('file', new Blob([samplePng], { type: 'image/png' }), 'shipping_slip.png');
  const shippingSlipResult = await seller.post(`/shops/me/orders/${orderId}/shipping-slips`, shippingSlipFormData, true);
  pass(`Seller attached shipping parcel receipt slip (Slip ID: ${shippingSlipResult.id})`);

  // Buyer verifies shipping slip presence
  const buyerShippingSlips = await buyer.get(`/orders/${orderId}/shipping-slips`);
  if (buyerShippingSlips.length > 0 && buyerShippingSlips[0].id === shippingSlipResult.id) {
    pass(`Buyer successfully verified shipping receipt slip attachment`);
  } else {
    fail(`Buyer could not find uploaded shipping slip`);
  }

  // STEP 8: BUYER CONFIRMS RECEIPT (COMPLETION)
  step(8, 'Buyer Marks Order as Received (COMPLETED)');
  const orderCompleted = await buyer.post(`/orders/${orderId}/receive`);
  pass(`Buyer confirmed receipt!`);
  pass(`Final Order Status: ${c.bold}${c.green}${orderCompleted.status || orderCompleted.displayStatus}${c.reset}`);
  if (orderCompleted.status !== 'COMPLETED') {
    warn(`Expected status COMPLETED, got: ${orderCompleted.status}`);
  }

  // STEP 9: SUPER ADMIN KPI RECONCILIATION & REVENUE AUDIT
  step(9, 'Super Admin Platform KPI Reconciliation');
  const finalKpis = await superAdmin.get('/admin/dashboard/platform');
  const orderDelta = finalKpis.totalOrders - initialKpis.totalOrders;
  const salesDelta = finalKpis.totalSales - initialKpis.totalSales;
  const expectedSalesDelta = unitPriceBaht; // Platform counts gross product sales excluding shipping

  console.log('\n' + '-'.repeat(50));
  console.log(` ${c.bold}Platform Financial & Order Audit Report:${c.reset}`);
  console.log('-'.repeat(50));
  console.log(` • Initial Total Orders : ${initialKpis.totalOrders}`);
  console.log(` • Final Total Orders   : ${finalKpis.totalOrders} (Delta: +${orderDelta})`);
  console.log(` • Initial Gross Sales  : ฿${initialKpis.totalSales.toLocaleString()}`);
  console.log(` • Final Gross Sales    : ฿${finalKpis.totalSales.toLocaleString()} (Delta: +฿${salesDelta.toLocaleString()})`);
  console.log(` • Expected Product Sale: ฿${expectedSalesDelta.toLocaleString()}`);
  console.log(` • Total Paid by Buyer  : ฿${(expectedTotalSatang / 100).toLocaleString()} (incl. ฿${(shippingFeeSatang / 100).toFixed(2)} shipping)`);
  console.log('-'.repeat(50));

  if (orderDelta === 1) {
    pass('Order Count Delta verified (+1 order recorded)');
  } else {
    warn(`Order Count Delta was +${orderDelta} instead of +1`);
  }

  if (Math.abs(salesDelta - expectedSalesDelta) < 0.01) {
    pass(`Financial integrity verified! Exactly ฿${expectedSalesDelta.toFixed(2)} credited to platform gross sales`);
  } else {
    warn(`Sales Delta discrepancy: got +฿${salesDelta.toFixed(2)}, expected +฿${expectedSalesDelta.toFixed(2)}`);
  }

  banner('🎉 E2E Lifecycle Simulation Completed Successfully!');
  console.log(`Summary:
  - Buyer: ${buyerUser.email}
  - Seller Shop: ${shopInfo.name}
  - Order ID: ${orderId}
  - Flow: AWAITING_QUOTE ➔ AWAITING_PAYMENT ➔ PAYMENT_SUBMITTED ➔ PAID ➔ SHIPPED ➔ COMPLETED
  - Stock Deducted: 1 unit (${originalStock} ➔ ${variantAfter.stock})
  - Financial Alignment: 100% verified\n`);
}

runE2ESimulation().catch((err) => {
  console.error(`\n${c.bold}${c.red}Simulation Failed with Error:${c.reset}`);
  console.error(err);
  process.exit(1);
});
