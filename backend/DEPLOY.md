# Deploying Limitless Backend to the VPS

Target server: `160.153.179.249` (Ubuntu + Nginx + PM2 — shared with Vigil).

> ⚠️ **Rules from the infra doc (Vigil_Team_Reply_30June2026.pdf):**
> ports **3000/3001 are reserved for Vigil** — Limitless uses **port 4000**.
> Never touch `/etc/nginx/sites-enabled/vigil`, never run `pm2 delete all` / `pm2 kill`,
> never modify `/var/www/html/vigil-child-backend-main`.

## 1. Upload the project

From your local machine (this folder):

```bash
scp -r ./backend homeubuntu@160.153.179.249:/var/www/html/limitless-backend
```

(or FileZilla → host `160.153.179.249`, user `homeubuntu`, port 22)

## 2. Install & configure

SSH in, then:

```bash
ssh homeubuntu@160.153.179.249
cd /var/www/html/limitless-backend
npm install --omit=dev
nano .env        # paste the .env contents (see .env in this folder), Ctrl+X > Y > Enter
```

The `.env` must contain at minimum: `PORT=4000`, `MONGODB_URI=...`, `JWT_SECRET=...`,
`ADMIN_PASSWORD=...`, `PUBLIC_BASE_URL=https://<your-api-domain>`.

## 3. Start with PM2 on port 4000

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # run the sudo command it prints (only needed once)
pm2 logs limitless-backend   # verify: "listening on port 4000" + "connected to MongoDB"
```

## 4. Nginx site (separate from Vigil's config)

```bash
sudo nano /etc/nginx/sites-available/limitless
```

Paste (replace `api.limitlessworld.net` with the real API domain, or use `_`):

```nginx
server {
    listen 80;
    server_name api.limitlessworld.net;

    client_max_body_size 20M;   # PDF uploads

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 180s;   # PDF/AI requests can be slow
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable + reload:

```bash
sudo ln -s /etc/nginx/sites-available/limitless /etc/nginx/sites-enabled/
sudo nginx -t          # MUST say: syntax is ok / test is successful
sudo systemctl reload nginx
```

## 5. HTTPS

Point the DNS A-record of `api.limitlessworld.net` to `160.153.179.249`, then:

```bash
sudo certbot --nginx -d api.limitlessworld.net
```

## 6. MongoDB Atlas network access

In Atlas → Network Access → add the VPS IP `160.153.179.249` (or `0.0.0.0/0`).
Without this, the backend logs `MongoDB connection failed` and DB routes return 503.

## 7. Verify

```bash
curl http://localhost:4000/health            # on the server
curl https://api.limitlessworld.net/health   # from anywhere, after DNS+SSL
```

Expect `{"status":"ok",...,"features":{"database":true,...}}`.

## 8. Point the frontend at it

- `src/lib/apiUtils.js` → base URL `https://api.limitlessworld.net`
- `public/api-proxy.php` → `BACKEND_URL` the same

## Updating later

```bash
cd /var/www/html/limitless-backend
# upload changed files (scp/FileZilla), then:
npm install --omit=dev
pm2 restart limitless-backend
```
