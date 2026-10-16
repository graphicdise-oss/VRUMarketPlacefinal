#!/usr/bin/env node
/**
 * Demo-data verifier — READ ONLY. It runs SELECTs and nothing else.
 *
 *   npm run db:verify-demo
 *
 * Answers one question: "if a tester logs in as each role, is there something to look at?"
 * It also catches the kind of half-finished seed run that leaves orders without items, and the
 * demo-only leftovers that must not survive a go-live.
 *
 * Exit code 1 when a FAIL is found (a role would see an empty or broken screen), 0 otherwise.
 * WARN means "works, but a tester may not be able to exercise this flow".
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
// Belt and braces: even a typo in this file cannot write.
await client.query('SET default_transaction_read_only = on');

const q = async (sql, params = []) => (await client.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0] ?? {};
const n = async (sql, params = []) => Number((await one(sql, params)).n ?? 0);

let fails = 0;
let warns = 0;
const line = (tag, text) => console.log(`  ${tag} ${text}`);
const pass = (t) => line('PASS', t);
const info = (t) => line('INFO', t);
const warn = (t) => { warns++; line('WARN', t); };
const fail = (t) => { fails++; line('FAIL', t); };
const check = (ok, good, bad, level = fail) => (ok ? pass(good) : level(bad));
const section = (t) => console.log(`\n=== ${t}`);

const DEMO = {
  superAdmins: ['superadmin@vru.ac.th', 'super@vru.ac.th'],
  communityAdmin: 'community.admin@vru.ac.th',
  sellers: ['seller.demo@vru.ac.th', 'seller2@vru.ac.th', 'seller3@vru.ac.th', 'seller4@vru.ac.th', 'seller5@vru.ac.th', 'seller6@vru.ac.th'],
  buyer: 'buyer.demo@vru.ac.th',
};

const enumLabels = async (table, column) => {
  const [{ udt_name }] = await q(
    `select udt_name from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
    [table, column],
  );
  return (await q(`select e.enumlabel as l from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname=$1 order by e.enumsortorder`, [udt_name])).map((r) => r.l);
};
const userId = async (email) => (await one(`select id from "user" where email=$1`, [email])).id;

try {
  // ---------------------------------------------------------------- accounts
  section('Accounts (can each demo persona actually sign in?)');
  const everyone = [...DEMO.superAdmins, DEMO.communityAdmin, ...DEMO.sellers, DEMO.buyer];
  const rows = await q(
    `select email, role, password_hash is not null as has_pw, email_verified_at is not null as verified,
            banned_at is not null as banned, erased_at is not null as erased
       from "user" where email = any($1)`,
    [everyone],
  );
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  for (const email of everyone) {
    const r = byEmail.get(email);
    if (!r) { fail(`${email}: account missing`); continue; }
    const ok = r.has_pw && r.verified && !r.banned && !r.erased;
    check(ok, `${email} (${r.role}) can sign in`, `${email} cannot sign in (password:${r.has_pw} verified:${r.verified} banned:${r.banned} erased:${r.erased})`);
  }
  for (const email of DEMO.superAdmins) {
    const r = byEmail.get(email);
    if (r && r.role !== 'SUPER_ADMIN') fail(`${email} should be SUPER_ADMIN but is ${r.role}`);
  }

  // ------------------------------------------------------------- super admin
  section('SUPER ADMIN sees');
  check((await n(`select count(*) n from community`)) > 0, `${await n('select count(*) n from community')} communities`, 'no communities');
  check((await n(`select count(*) n from banner where is_active`)) > 0, `${await n('select count(*) n from banner where is_active')} active home banners`, 'no active banners (home hero is empty)');
  check((await n(`select count(*) n from article`)) > 0, `${await n('select count(*) n from article')} articles`, 'no articles');
  const reqs = await q(`select status, count(*)::int c from community_request group by 1`);
  check(reqs.some((r) => r.status === 'PENDING'), `community requests: ${reqs.map((r) => `${r.status}=${r.c}`).join(', ')}`, 'no PENDING community request to approve/reject', warn);
  check((await n(`select count(*) n from audit_log`)) > 0, `${await n('select count(*) n from audit_log')} audit-log entries`, 'audit log is empty', warn);
  check((await n(`select count(*) n from community_admin`)) > 0, `${await n('select count(*) n from community_admin')} community-admin assignments`, 'no community admins assigned');
  const shopsBy = await q(`select approval_status s, count(*)::int c from shop group by 1 order by 1`);
  info(`shops by approval: ${shopsBy.map((r) => `${r.s}=${r.c}`).join(', ') || 'none'}`);
  const reportsBy = await q(`select status, count(*)::int c from chat_report group by 1`);
  check(reportsBy.length > 0, `chat reports: ${reportsBy.map((r) => `${r.status}=${r.c}`).join(', ')}`, 'no chat reports to moderate', warn);

  // --------------------------------------------------------- community admin
  section('COMMUNITY ADMIN (community.admin@vru.ac.th) sees');
  const caId = await userId(DEMO.communityAdmin);
  if (!caId) fail('account missing');
  else {
    const comms = await q(`select c.id, c.name from community_admin a join community c on c.id=a.community_id where a.user_id=$1`, [caId]);
    check(comms.length > 0, `manages ${comms.length} communities`, 'is not assigned to any community (admin console is empty)');
    const ids = comms.map((c) => c.id);
    const sh = await q(`select approval_status s, count(*)::int c from shop where community_id = any($1) group by 1`, [ids]);
    const shMap = Object.fromEntries(sh.map((r) => [r.s, r.c]));
    info(`shops in those communities: ${sh.map((r) => `${r.s}=${r.c}`).join(', ')}`);
    check((shMap.PENDING ?? 0) > 0, 'has PENDING shop(s) to approve', 'no PENDING shop to approve — approval flow cannot be demonstrated', warn);
    check((shMap.APPROVED ?? 0) > 0, 'has APPROVED shop(s)', 'no APPROVED shop');
    const pr = await q(`select p.moderation_status s, count(*)::int c from product p join shop s on s.id=p.shop_id where s.community_id = any($1) and p.deleted_at is null group by 1`, [ids]);
    const prMap = Object.fromEntries(pr.map((r) => [r.s, r.c]));
    info(`products in those communities: ${pr.map((r) => `${r.s}=${r.c}`).join(', ')}`);
    check((prMap.PENDING ?? 0) > 0, 'has PENDING product(s) to review', 'no PENDING product to review', warn);
    check((prMap.REJECTED ?? 0) > 0, 'has REJECTED product(s)', 'no REJECTED product example', warn);
    const disputes = await n(`select count(*) n from dispute d join "order" o on o.id=d.order_id join shop s on s.id=o.shop_id where s.community_id = any($1)`, [ids]);
    check(disputes > 0, `${disputes} dispute(s) to handle`, 'no dispute in these communities — dispute handling cannot be demonstrated', warn);
  }

  // ------------------------------------------------------------------ sellers
  section('SELLER sees (per demo seller)');
  const orderStatuses = await enumLabels('order', 'status');
  for (const email of DEMO.sellers) {
    const uid = await userId(email);
    if (!uid) { fail(`${email}: account missing`); continue; }
    const shop = await one(`select id, name, approval_status from shop where owner_id=$1`, [uid]);
    if (!shop.id) { fail(`${email}: owns no shop`); continue; }
    console.log(`  -- ${email} → ${shop.name} [${shop.approval_status}]`);
    check(shop.approval_status === 'APPROVED', 'shop APPROVED', `shop is ${shop.approval_status}`);
    check((await n(`select count(*) n from payment_channel where shop_id=$1`, [shop.id])) > 0, 'payment channel set', 'no payment channel — buyers cannot pay');
    const sp = await q(`select moderation_status s, count(*)::int c from product where shop_id=$1 and deleted_at is null group by 1`, [shop.id]);
    const spMap = Object.fromEntries(sp.map((r) => [r.s, r.c]));
    check((spMap.APPROVED ?? 0) > 0, `${spMap.APPROVED ?? 0} APPROVED products`, 'no APPROVED product');
    if (email === DEMO.sellers[0]) {
      check((spMap.PENDING ?? 0) > 0, 'has PENDING product', 'no PENDING product', warn);
      check((spMap.REJECTED ?? 0) > 0, 'has REJECTED product', 'no REJECTED product', warn);
    }
    const os = await q(`select status s, count(*)::int c from "order" where shop_id=$1 group by 1`, [shop.id]);
    const have = new Set(os.map((r) => r.s));
    const missing = orderStatuses.filter((s) => !have.has(s));
    check(os.length > 0, `orders: ${os.map((r) => `${r.s}=${r.c}`).join(', ')}`, 'no orders');
    if (email === DEMO.sellers[0] && missing.length) warn(`order statuses not represented: ${missing.join(', ')}`);
    check((await n(`select count(*) n from shop_coupon where shop_id=$1 and is_active and end_date > now()`, [shop.id])) > 0, 'has a live coupon', 'no live coupon', warn);
    check((await n(`select count(*) n from review where shop_id=$1 and deleted_at is null`, [shop.id])) > 0, 'has reviews', 'no reviews', warn);
    if (email === DEMO.sellers[0]) {
      check((await n(`select count(*) n from chat_room where shop_owner_user_id=$1`, [uid])) > 0, 'has chat room(s)', 'no chat room (seller chat is empty)');
      check((await n(`select count(*) n from notification where user_id=$1`, [uid])) > 0, 'has notifications', 'no notifications', warn);
      check((await n(`select count(*) n from shop_follow where shop_id=$1`, [shop.id])) > 0, 'has followers', 'no followers', warn);
    }
  }

  // -------------------------------------------------------------------- buyer
  section('BUYER (buyer.demo@vru.ac.th) sees');
  const bId = await userId(DEMO.buyer);
  if (!bId) fail('account missing');
  else {
    check((await n(`select count(*) n from address where user_id=$1 and deleted_at is null`, [bId])) > 0, 'has a saved address', 'no saved address (checkout blocked)');
    const bo = await q(`select status s, count(*)::int c from "order" where buyer_id=$1 group by 1`, [bId]);
    const have = new Set(bo.map((r) => r.s));
    check(bo.length > 0, `orders: ${bo.map((r) => `${r.s}=${r.c}`).join(', ')}`, 'no orders');
    const missing = orderStatuses.filter((s) => !have.has(s));
    if (missing.length) warn(`order statuses not represented: ${missing.join(', ')}`);
    check((await n(`select count(*) n from cart_item ci join cart c on c.id=ci.cart_id where c.user_id=$1`, [bId])) > 0, 'cart has items', 'cart is empty', warn);
    check((await n(`select count(*) n from favorite where user_id=$1`, [bId])) > 0, 'has favorites', 'no favorites', warn);
    check((await n(`select count(*) n from shop_follow where user_id=$1`, [bId])) > 0, 'follows shops', 'follows no shop', warn);
    check((await n(`select count(*) n from user_coupon_claim where user_id=$1 and not is_used`, [bId])) > 0, 'has unused claimed coupons', 'no unused coupon', warn);
    check((await n(`select count(*) n from chat_room where buyer_id=$1`, [bId])) > 0, 'has chat room(s)', 'no chat room (buyer chat is empty)');
    check((await n(`select count(*) n from notification where user_id=$1 and read_at is null`, [bId])) > 0, 'has unread notifications', 'no unread notifications', warn);
    check((await n(`select count(*) n from review where buyer_id=$1 and deleted_at is null`, [bId])) > 0, 'has written a review', 'no review written', warn);
    check(
      (await n(`select count(*) n from "order" o where o.buyer_id=$1 and o.status='COMPLETED' and not exists (select 1 from review r where r.order_id=o.id)`, [bId])) > 0,
      'has a COMPLETED order still awaiting review',
      'no COMPLETED order left to review (review flow cannot be demonstrated)',
      warn,
    );
  }

  // ---------------------------------------------------------------- storefront
  section('Public storefront (what a logged-out visitor sees)');
  const pub = await n(`select count(*) n from product p join shop s on s.id=p.shop_id where p.deleted_at is null and p.moderation_status='APPROVED' and s.approval_status='APPROVED' and s.closed_at is null and s.suspended_at is null`);
  check(pub > 0, `${pub} publicly visible products`, 'no publicly visible product');
  check((await n(`select count(*) n from category`)) > 0, `${await n('select count(*) n from category')} categories`, 'no categories');
  check((await n(`select count(*) n from shipping_carrier`)) > 0, `${await n('select count(*) n from shipping_carrier')} shipping carriers`, 'no carriers (sellers cannot ship)');
  check((await n(`select count(*) n from province`)) > 0, `${await n('select count(*) n from province')} provinces (address form)`, 'address reference data missing');
  const noVariant = await n(`select count(*) n from product p where p.deleted_at is null and p.moderation_status='APPROVED' and not exists (select 1 from product_variant v where v.product_id=p.id and v.deleted_at is null and v.stock>0)`);
  check(noVariant === 0, 'every approved product is purchasable (has an in-stock variant)', `${noVariant} approved product(s) have no in-stock variant`, warn);
  const noImg = await n(`select count(*) n from product p where p.deleted_at is null and p.moderation_status='APPROVED' and not exists (select 1 from product_image i where i.product_id=p.id)`);
  if (noImg) warn(`${noImg} approved product(s) have NO uploaded image — the UI falls back to Unsplash URLs, which will not load on a network without internet`);
  const ext = await n(`select (select count(*) from banner where image_url ~* '^https?://') + (select count(*) from article where image ~* '^https?://') as n`);
  if (ext) warn(`${ext} banner/article image(s) point to external http(s) URLs — they will be blank if the test network has no internet`);

  // ---------------------------------------------------------------- integrity
  section('Data integrity');
  const noItems = await n(`select count(*) n from "order" o where not exists (select 1 from order_item i where i.order_id=o.id)`);
  check(noItems === 0, 'every order has items', `${noItems} order(s) have NO items (a seed run was interrupted) — re-run the order seeds`);
  const bad = await q(
    `select o.id, o.status, o.total_amount_minor t, coalesce(sum(i.price_at_purchase*i.quantity),0)::int items,
            o.discount_amount_minor d, o.shipping_amount_minor s
       from "order" o left join order_item i on i.order_id=o.id
      group by o.id
     having o.total_amount_minor <> coalesce(sum(i.price_at_purchase*i.quantity),0) - o.discount_amount_minor + coalesce(o.shipping_amount_minor,0)`,
  );
  check(bad.length === 0, 'order totals = items − discount + shipping', `${bad.length} order(s) have an inconsistent total (e.g. ${bad.slice(0, 3).map((r) => `${r.status}: total ${r.t} vs items ${r.items} −${r.d} +${r.s ?? 0}`).join(' | ')})`);
  const negStock = await n(`select count(*) n from product_variant where stock < 0`);
  check(negStock === 0, 'no negative stock', `${negStock} variant(s) with negative stock`);
  const couponBad = await n(
    `select count(*) n from shop_coupon c where c.claimed_count > c.quota or c.used_count > c.claimed_count
        or c.claimed_count < (select count(*) from user_coupon_claim x where x.coupon_id=c.id)
        or c.used_count < (select count(*) from user_coupon_claim x where x.coupon_id=c.id and x.is_used)`,
  );
  check(couponBad === 0, 'coupon counters are consistent with real claims', `${couponBad} coupon(s) have counters that contradict real claims`, warn);

  // ----------------------------------------------------------------- security
  section('Security / go-live hygiene');
  const knownPw = await q(`select email, role from "user" where email ~* '@vru\\.ac\\.th$' order by role, email`);
  warn(`${knownPw.length} account(s) use publicly documented demo passwords (${knownPw.filter((u) => u.role === 'SUPER_ADMIN').length} are SUPER_ADMIN). They are for the test team only — remove them before go-live.`);
  const superNoPw = await n(`select count(*) n from "user" where role='SUPER_ADMIN' and password_hash is null and google_subject is null`);
  if (superNoPw) info(`${superNoPw} SUPER_ADMIN account(s) have no password and no Google link (cannot sign in until a reset)`);
} catch (error) {
  fail(`verifier crashed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await client.end();
}

console.log(`\nResult: ${fails} FAIL, ${warns} WARN`);
process.exit(fails > 0 ? 1 : 0);
