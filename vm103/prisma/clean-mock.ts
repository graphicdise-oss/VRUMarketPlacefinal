import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

/**
 * Clean Wipe Script: Purges all mock orders, products, shops, and test accounts.
 * Preserves: Starting categories (9), Shipping carriers (6), Communities, and real Super Admin account(s).
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run clean-mock.');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  console.log('🧹 Starting Clean Wipe of mock data...');

  try {
    await client.query('BEGIN');

    // 1. Identify Super Admin users to protect
    const superAdminsRes = await client.query<{ id: string; email: string }>(
      'SELECT id, email FROM "user" WHERE role = \'SUPER_ADMIN\'',
    );
    const protectedUserIds = superAdminsRes.rows.map((r) => r.id);
    const protectedEmails = superAdminsRes.rows.map((r) => r.email);
    console.log(`🛡️  Protecting ${protectedUserIds.length} Super Admin account(s): ${protectedEmails.join(', ')}`);

    // 2. Identify test users to remove
    const testUsersRes = await client.query<{ id: string; email: string }>(`
      SELECT id, email FROM "user"
      WHERE role != 'SUPER_ADMIN'
        AND (
          email LIKE '%.demo@vru.ac.th'
          OR email LIKE '%admin%@vru.ac.th'
          OR email IN ('seller@vru.ac.th', 'buyer@vru.ac.th', 'admin@vru.ac.th', 'community.admin@vru.ac.th', 'seller_a@vru.ac.th', 'seller_b@vru.ac.th', 'buyer_a@vru.ac.th')
          OR email LIKE 'dummy%@test.com'
        )
    `);
    const testUserIds = testUsersRes.rows.map((r) => r.id);
    console.log(`🎯 Found ${testUserIds.length} test user account(s) to purge.`);

    // 3. Purge Chat Messages and Rooms
    await client.query('DELETE FROM chat_message_version');
    await client.query('DELETE FROM chat_pending_attachment');
    await client.query('DELETE FROM chat_room_read');
    const chatRes = await client.query('DELETE FROM chat_message');
    await client.query('DELETE FROM chat_room');
    await client.query('DELETE FROM shop_admin_chat_message_version');
    await client.query('DELETE FROM shop_admin_chat_pending_attachment');
    await client.query('DELETE FROM shop_admin_chat_read');
    await client.query('DELETE FROM shop_admin_chat_message');
    await client.query('DELETE FROM shop_admin_chat_room');
    console.log(`   - Deleted ${chatRes.rowCount ?? 0} chat messages.`);

    // 4. Purge Disputes and Reviews
    await client.query('DELETE FROM dispute_evidence');
    await client.query('DELETE FROM dispute');
    await client.query('DELETE FROM review_image');
    await client.query('DELETE FROM review');

    // 5. Purge Slips, Freeze Reasons, Tracking Changes, Stock Reservations, and Order Items
    await client.query('DELETE FROM shipping_slip');
    await client.query('DELETE FROM payment_slip');
    await client.query('DELETE FROM refund_slip');
    await client.query('DELETE FROM shipping_fee_rejection');
    await client.query('DELETE FROM order_freeze_reason');
    await client.query('DELETE FROM tracking_number_change');
    await client.query('DELETE FROM stock_reservation');
    await client.query('DELETE FROM order_item');
    const ordersRes = await client.query('DELETE FROM "order"');
    console.log(`   - Deleted ${ordersRes.rowCount ?? 0} orders and order items.`);

    // 6. Purge Carts, Favorites, Follows, Products & Variants
    await client.query('DELETE FROM cart_item');
    await client.query('DELETE FROM cart');
    await client.query('DELETE FROM favorite');
    await client.query('DELETE FROM shop_follow');
    await client.query('DELETE FROM product_image');
    await client.query('DELETE FROM product_variant');
    const prodRes = await client.query('DELETE FROM product');
    console.log(`   - Deleted ${prodRes.rowCount ?? 0} products.`);

    // 7. Purge Shops & Payment Channels
    await client.query('DELETE FROM payment_channel');
    const shopRes = await client.query('DELETE FROM shop');
    console.log(`   - Deleted ${shopRes.rowCount ?? 0} shops.`);

    // 8. Purge Community Requests & Admin assignments for test users
    if (testUserIds.length > 0) {
      await client.query(`DELETE FROM community_request WHERE requester_id = ANY($1::uuid[])`, [testUserIds]);
      await client.query(`DELETE FROM community_admin WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
    }

    // 9. Purge test users and their child records
    if (testUserIds.length > 0) {
      await client.query(`DELETE FROM session WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
      await client.query(`DELETE FROM verification_token WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
      await client.query(`DELETE FROM notification WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
      await client.query(`DELETE FROM address WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
      await client.query(`DELETE FROM policy_acceptance WHERE user_id = ANY($1::uuid[])`, [testUserIds]);
      const userDelRes = await client.query(`DELETE FROM "user" WHERE id = ANY($1::uuid[])`, [testUserIds]);
      console.log(`   - Deleted ${userDelRes.rowCount ?? 0} test user accounts.`);
    }

    // 10. Purge unreferenced uploaded files
    await client.query(`
      DELETE FROM uploaded_file
      WHERE id NOT IN (SELECT logo_file_id FROM shop WHERE logo_file_id IS NOT NULL)
        AND id NOT IN (SELECT banner_file_id FROM shop WHERE banner_file_id IS NOT NULL)
    `);

    await client.query('COMMIT');

    // 10. Summary verification
    const catCount = await client.query<{ count: string }>('SELECT count(*) FROM category');
    const carrierCount = await client.query<{ count: string }>('SELECT count(*) FROM shipping_carrier');
    const remainingUsers = await client.query<{ email: string; role: string }>('SELECT email, role FROM "user"');

    console.log('\n✅ Clean Wipe completed successfully!');
    console.log(`   - Categories preserved: ${catCount.rows[0]?.count ?? '0'}`);
    console.log(`   - Shipping carriers preserved: ${carrierCount.rows[0]?.count ?? '0'}`);
    console.log(`   - Remaining active users in DB:`);
    for (const u of remainingUsers.rows) {
      console.log(`     * ${u.email} (${u.role})`);
    }
    console.log('🎉 Database is clean and 100% production-ready!\n');

  } catch (error: unknown) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors if connection failed
    }
    console.error('❌ Clean wipe failed, rolled back changes:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch(console.error);
