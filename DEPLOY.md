# Assist — Deployment Guide

## What's included

```
assist-backend/
├── server.js          ← Express API server
├── db.js              ← SQLite database layer
├── email.js           ← Email notifications (confirmation + admin alerts + quotes)
├── admin.html         ← Admin dashboard (served at /admin)
├── public/
│   └── index.html     ← Your website (served at /)
├── .env.example       ← Copy this to .env and fill in your values
├── package.json
└── DEPLOY.md          ← This file
```

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Your website |
| GET | `/admin` | Admin dashboard |
| GET | `/api/health` | Health check |
| POST | `/api/orders` | Submit new order (public) |
| GET | `/api/orders/:id` | Track order by ID (public) |
| POST | `/api/admin/login` | Admin login |
| GET | `/api/admin/orders` | List all orders |
| GET | `/api/admin/stats` | Dashboard stats |
| PATCH | `/api/admin/orders/:id` | Update status/quote/notes |
| DELETE | `/api/admin/orders/:id` | Delete order |

---

## Deploy on Railway (Recommended — Free tier available)

**Railway** is the fastest way to deploy a Node.js backend with zero config.

1. Go to https://railway.app and sign up (free)
2. Click **"New Project" → "Deploy from GitHub"**
3. Push your `assist-backend` folder to a GitHub repo
4. Railway auto-detects Node.js and deploys it
5. In Railway dashboard → **Variables**, add:
   ```
   PORT=3000
   ADMIN_PASSWORD=YourSecurePassword123
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=youremail@gmail.com
   SMTP_PASS=your-gmail-app-password
   ADMIN_EMAIL=youremail@gmail.com
   WHATSAPP_NUMBER=254700000000
   SITE_URL=https://your-railway-url.up.railway.app
   ```
6. Railway gives you a URL like `https://assist-production.up.railway.app`
7. Your site: `https://your-url.up.railway.app/`
8. Your admin: `https://your-url.up.railway.app/admin`

---

## Alternative: Deploy on Render (Also free)

1. Go to https://render.com and sign up
2. New → Web Service → connect your GitHub repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Add environment variables in the Render dashboard
6. Free tier spins down after inactivity (15 min), paid tier stays always on

---

## Alternative: Deploy on a VPS (DigitalOcean, Hetzner, etc.)

```bash
# On your server:
git clone your-repo
cd assist-backend
cp .env.example .env
nano .env  # fill in your values
npm install
npm install -g pm2
pm2 start server.js --name assist
pm2 save
pm2 startup
```

---

## Setting up Gmail for emails

1. Go to your Google Account → Security → 2-Step Verification (enable it)
2. Then go to Security → App passwords
3. Create an app password for "Mail"
4. Use that 16-character password as `SMTP_PASS` — NOT your normal Gmail password

---

## After deploying: Update your frontend

In `public/index.html`, find this line:
```javascript
const API_URL = window.EDUASSIST_API || 'http://localhost:3000';
```

Since the frontend is served from the same server, this works automatically.
If you host the frontend separately (e.g. on Netlify), add this before the script:
```html
<script>window.EDUASSIST_API = 'https://your-backend-url.up.railway.app';</script>
```

---

## Admin Dashboard

Visit `/admin` on your deployed URL.
Password = whatever you set as `ADMIN_PASSWORD` in `.env`

Features:
- View all orders with filters (New / In Progress / Completed / Cancelled)
- Search by name, email, service, or order ID
- Click any order to open full details
- Update status, add admin notes, set a quote price
- Send quote email to client with one click
- Direct WhatsApp and email links to each client
- Stats overview with order counts and service breakdown

---

## Local development

```bash
cd assist-backend
cp .env.example .env
# edit .env with your values
npm install
node server.js
# Visit http://localhost:3000
# Admin: http://localhost:3000/admin
```
