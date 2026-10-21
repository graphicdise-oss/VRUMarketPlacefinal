#!/bin/bash
set -e

echo "=========================================================="
echo "🚀 Starting VRU Marketplace Production Deployment"
echo "=========================================================="

PROJECT_DIR="/home/ubuntu/VRUMarketPlacefinal"
BACKEND_DIR="$PROJECT_DIR/backend/Backend-VRU-Marketplace-main"
FRONTEND_DIR="$PROJECT_DIR"
UPLOAD_DIR="/home/ubuntu/uploads"

# 1. Prepare upload folder
echo "📁 [1/5] Creating uploads folder..."
mkdir -p "$UPLOAD_DIR"
chmod 777 "$UPLOAD_DIR"

# 2. Setup Backend .env
echo "⚙️ [2/5] Creating Backend .env configuration..."
cat << 'EOF' > "$BACKEND_DIR/.env"
NODE_ENV=production
PORT=3001
POSTGRES_PORT=5432
POSTGRES_PASSWORD=vru_marketplace_2026
DATABASE_URL=postgresql://postgres:vru_marketplace_2026@localhost:5432/vru_marketplace

SUPER_ADMIN_EMAIL=superadmin@vru.ac.th
ACCOUNT_MARKER_PEPPER=a16dd6adb2acaee171967b91eac23fb0ab45ba4af343ad7e154018de45416346

ACCESS_TOKEN_SECRET=13634a0c9211e0e56d118e4960be0b62f73a569cf53062e7aa98e78e191b4391
REFRESH_TOKEN_SECRET=f63081b4797341a30e9ee804a4a029579825e5e1b5f68705bccb8b2b26bc8dc5
CSRF_SECRET=467c8cf373278b7bdc82100361ac0549e796393b202504d40409a1b9a255d7be
VERIFICATION_TOKEN_SECRET=15a2b895ba8af696e110d4d5a5aaeb9b9c9c461c78b56f46385fe3872fb0e501

UPLOAD_DIR=/home/ubuntu/uploads
MAX_IMAGE_UPLOAD_BYTES=10485760
IMAGE_PROCESSING_CONCURRENCY=2
IMAGE_PROCESSING_QUEUE_TIMEOUT_MS=20000

EMAIL_TRANSPORT=brevo
BREVO_API_KEY=67a3a78c2a63985339af43f025967f7a6f3da139644d91b879c33d03ca422e68
SMTP_HOST=mail.vrumarketplace.com
SMTP_PORT=587
SMTP_USER=noreply@vrumarketplace.com
SMTP_PASSWORD=vru_mail_password_2026
MAIL_FROM_ADDRESS=noreply@vrumarketplace.com
MAIL_FROM_NAME=VRU Marketplace

FRONTEND_BASE_URL=https://vrumarketplace.com
TRUST_PROXY_HOPS=1

RATE_LIMIT_LOGIN_PER_15_MIN=30
RATE_LIMIT_REGISTER_PER_HOUR=20
RATE_LIMIT_EMAIL_LINK_PER_HOUR=20
RATE_LIMIT_LOGIN_PER_IP_PER_HOUR=120
RATE_LIMIT_REGISTER_PER_IP_PER_HOUR=60
RATE_LIMIT_PASSWORD_RESET_PER_IP_PER_HOUR=60
RATE_LIMIT_UPLOAD_PER_HOUR=100
EOF

# 3. Setup Frontend .env.local
echo "⚙️ [3/5] Creating Frontend .env.local configuration..."
cat << 'EOF' > "$FRONTEND_DIR/.env.local"
NEXT_PUBLIC_API_URL=/api/v1
EOF

# 4. Install & Build Backend
echo "📦 [4/5] Installing Backend dependencies and building..."
cd "$BACKEND_DIR"
npm install --legacy-peer-deps
npx prisma generate
npm run build
pm2 delete vru-backend 2>/dev/null || true
pm2 start dist/main.js --name "vru-backend"

# 5. Install & Build Frontend
echo "🌐 [5/5] Installing Frontend dependencies and building..."
cd "$FRONTEND_DIR"
npm install --legacy-peer-deps
npm run build
pm2 delete vru-frontend 2>/dev/null || true
pm2 start npm --name "vru-frontend" -- start

pm2 save

echo "=========================================================="
echo "✅ Both Backend (port 3001) and Frontend (port 3000) are running under PM2!"
echo "=========================================================="
pm2 status
