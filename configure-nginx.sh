#!/bin/bash
set -e

echo "=== 🌐 Configuring Nginx Reverse Proxy for vrumarketplace.com ==="

# 1. Backup original configuration
if [ -f /etc/nginx/sites-available/default ] && [ ! -f /etc/nginx/sites-available/default.orig.bak ]; then
    cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.orig.bak
fi

# 2. Check Certbot SSL files
SSL_CERT="/etc/letsencrypt/live/vrumarketplace.com/fullchain.pem"
SSL_KEY="/etc/letsencrypt/live/vrumarketplace.com/privkey.pem"

EXTRA_SSL=""
if [ -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
    EXTRA_SSL="include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
if [ -f /etc/letsencrypt/ssl-dhparams.pem ]; then
    EXTRA_SSL="$EXTRA_SSL
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
fi

# 3. Create Nginx Site Configuration
cat << EOF > /etc/nginx/sites-available/vrumarketplace
# HTTP -> Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name vrumarketplace.com www.vrumarketplace.com;
    return 301 https://\$host\$request_uri;
}

# HTTPS -> Reverse Proxy to Next.js & NestJS
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name vrumarketplace.com www.vrumarketplace.com;

    ssl_certificate $SSL_CERT;
    ssl_certificate_key $SSL_KEY;
    $EXTRA_SSL

    # Upload file size limit (up to 25MB)
    client_max_body_size 25M;

    # 1. Backend API & Uploads -> Port 3001
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    # 2. Frontend Next.js Application -> Port 3000
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# 4. Enable site
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/vrumarketplace /etc/nginx/sites-enabled/vrumarketplace

# 5. Test and reload Nginx
nginx -t
systemctl reload nginx

echo "=========================================================="
echo "🎉 SUCCESS: Nginx is now actively serving vrumarketplace.com!"
echo "Visit: https://vrumarketplace.com"
echo "=========================================================="
