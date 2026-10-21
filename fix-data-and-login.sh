#!/bin/bash
set -e

BACKEND_DIR="/home/ubuntu/VRUMarketPlacefinal/backend/Backend-VRU-Marketplace-main"
cd "$BACKEND_DIR"

echo "=== 🔄 [1/4] Syncing Database Schema (creating missing tables like coupons & rate limits) ==="
npx prisma db push --accept-data-loss

echo "=== 🔑 [2/4] Updating Passwords for Admin, Seller, and Buyer Demo Accounts ==="
npx tsx prisma/seed-staging.ts

echo "=== 🎫 [3/4] Seeding Active Coupons & Promo Codes ==="
npx tsx prisma/seed-coupons.ts

echo "=== 🚀 [4/4] Restarting Backend API ==="
pm2 restart vru-backend
sleep 2
pm2 status

echo "=========================================================="
echo "🎉 SUCCESS: Database synced, passwords updated, and coupons active!"
echo "You can now login with:"
echo " - Super Admin: superadmin@vru.ac.th / SuperAdmin@VRU2026!"
echo " - Admin: community.admin@vru.ac.th / Admin@VRU2026"
echo " - Seller: seller.demo@vru.ac.th / Seller@VRU2026"
echo " - Buyer: buyer.demo@vru.ac.th / Buyer@VRU2026"
echo "=========================================================="
