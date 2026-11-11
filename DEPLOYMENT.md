# Deployment guide

Two paths: a self-managed Ubuntu VPS (Nginx + PM2 + Let's Encrypt), or a managed platform (Render or Railway) with MongoDB Atlas. Both assume you've already got a domain pointed at the server/platform and a Razorpay account.

Either way, before deploying:

1. Set `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` — most hosting platforms (including Render/Railway, and a VPS restarted without a persistent volume) have an **ephemeral filesystem**. Without Cloudinary configured, uploaded photos/thumbnails/logos get written to local disk and vanish on the next redeploy or restart.
2. Have a MongoDB connection string ready — either a self-hosted `mongod` on the VPS, or an Atlas cluster (recommended for both paths; a managed DB is one less thing to operate).
3. Have your Razorpay key ID/secret and a webhook secret ready (see the Payments section of the README).

---

## Option A — VPS (Ubuntu + Nginx + PM2 + Let's Encrypt)

### 1. Server setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git

# Node.js 20.x via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2, globally
sudo npm install -g pm2
```

If you're self-hosting MongoDB rather than using Atlas:

```bash
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] http://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update && sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

### 2. Deploy the app

```bash
# as a non-root deploy user, not root
git clone <this-repo> /home/deploy/celebracraft
cd /home/deploy/celebracraft
npm ci --omit=dev
cp .env.example .env
nano .env   # fill in every variable — see README.md for the full reference; set NODE_ENV=production

npm run build:css:prod
npm run seed:admin
npm run seed:templates
```

### 3. Run it under PM2

```bash
pm2 start app.js --name celebracraft
pm2 save
pm2 startup   # follow the printed command to enable PM2 on boot
```

Useful commands: `pm2 logs celebracraft`, `pm2 restart celebracraft` (after a deploy), `pm2 monit`.

### 4. Nginx reverse proxy

Create `/etc/nginx/sites-available/celebracraft`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10M;  # card photo uploads

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/celebracraft /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

> **Note:** `app.js` already sets `app.set('trust proxy', 1)`, which makes Express read the real client IP/protocol from the `X-Forwarded-*` headers Nginx sets above — needed for per-IP rate limiting and HTTPS detection to work correctly behind any reverse proxy. Nothing to change here, just worth knowing it's there.

### 5. HTTPS with Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot edits the Nginx config to redirect HTTP → HTTPS and sets up auto-renewal (`certbot renew` via a systemd timer, already installed). Confirm with:

```bash
sudo certbot renew --dry-run
```

### 6. Redeploying after a code change

```bash
cd /home/deploy/celebracraft
git pull
npm ci --omit=dev
npm run build:css:prod
pm2 restart celebracraft
```

---

## Option B — Render or Railway + MongoDB Atlas

Both platforms work the same way for this app: connect the repo, set a build command, a start command, and environment variables.

### 1. MongoDB Atlas

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Database Access → add a user with a strong password.
3. Network Access → allow access from anywhere (`0.0.0.0/0`) — both Render and Railway use dynamic egress IPs, so you can't easily allowlist a fixed range.
4. Copy the connection string into `MONGO_URI`.

### 2. Platform configuration

- **Build command:** `npm install && npm run build:css:prod`
- **Start command:** `npm start`
- **Environment variables:** every variable from `.env.example` (see README.md) — set `NODE_ENV=production` and `BASE_URL` to the platform-assigned domain (or your custom domain once attached).
- Both platforms provision HTTPS automatically for their own subdomains and for custom domains once DNS is pointed at them — no manual Let's Encrypt step needed here.
- Same `trust proxy` note as above — already set in `app.js`, and applies here too since both platforms sit their own proxy in front of your app.

### 3. First deploy

After the first successful deploy, run the seed scripts once via the platform's shell/console feature (Render: Shell tab on the service; Railway: `railway run`):

```bash
npm run seed:admin
npm run seed:templates
```

### 4. Cloudinary (not optional here)

Both platforms wipe the filesystem on every deploy/restart — local-disk upload storage will not survive. Set the three `CLOUDINARY_*` variables before your first real customer upload.

---

## Post-deploy checklist

- [ ] `NODE_ENV=production` (enables secure cookies, quieter error pages)
- [ ] `BASE_URL` matches the real public domain exactly (no trailing slash)
- [ ] Cloudinary configured, or you're deliberately accepting local-disk storage on a VPS with a persistent volume
- [ ] Razorpay webhook created in the dashboard, pointed at `https://<domain>/payments/webhook`, subscribed to `payment.captured` and `payment.failed`
- [ ] At least one pricing plan created at `/admin/plans` (no seed script for this — it's business-specific)
- [ ] Admin password changed from the seeded default
- [ ] SMTP configured (or you're accepting that reset/confirmation emails only log to console — fine for staging, not for real customers)
