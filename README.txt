ROLA — DEPLOYMENT PACKAGE
rolaglobal.com
─────────────────────────────────────────

FIRST TIME SETUP (run once in Terminal):

1. Move this ROLA folder to your Desktop
   (drag and drop — done)

2. Create GitHub repo at github.com/new
   Name: rolaglobal
   Visibility: Public
   No README, no .gitignore

3. Open Terminal and run:

   cd ~/Desktop/ROLA
   git init
   git remote add origin https://github.com/YOUR_USERNAME/rolaglobal.git
   chmod +x push.sh
   git add .
   git commit -m "ROLA — initial launch"
   git branch -M main
   git push -u origin main

4. Go to vercel.com
   New Project > Import rolaglobal repo
   Root Directory: www
   Build Command: (leave blank)
   Output Directory: (leave blank)
   Deploy

5. In Vercel > Domains > add rolaglobal.com
   Add DNS records at your registrar
   Live within 30 minutes

─────────────────────────────────────────

EVERY FUTURE UPDATE:

   ~/Desktop/ROLA/push.sh

That is it.

─────────────────────────────────────────

TO UPDATE A FILE:
Replace the file inside the www/ folder
then run push.sh

─────────────────────────────────────────

FOLDER STRUCTURE:

ROLA/
├── push.sh          ← one-command deploy
├── README.txt       ← this file
└── www/             ← all site files live here
    ├── index.html
    ├── about.html
    ├── what-we-build.html
    ├── rola-report.html
    ├── partner-inquiry.html
    ├── thank-you.html
    ├── 404.html
    ├── article_pillar1_NIL_Infrastructure.html
    ├── article_pillar2_NIL_Compliance.html
    ├── article_pillar3_Revenue_Sharing.html
    ├── article_pillar4_NIL_Recruiting.html
    ├── article_pillar5_Business_Entity.html
    ├── article_pillar6_NonRevenue_Sports.html
    ├── article_pillar7_Financial_Literacy.html
    ├── article_pillar8_Transfer_Portal.html
    ├── sitemap.xml
    └── robots.txt

─────────────────────────────────────────

WHEN CALENDLY IS SET UP:
Replace https://calendly.com/rolaglobal/strategy
with your actual Calendly URL in these files:
- about.html (CTA button)
- what-we-build.html (CTA button)
- article files (CTA button)
Then run push.sh

─────────────────────────────────────────

─────────────────────────────────────────

SINCE OCTOBER 2026: NEXT.JS + ROLA OS

www/ is now a Next.js app. The public site still lives as plain HTML
in www/public/ and every old URL keeps working.

  www/public/        the public website pages (edit these as before)
  www/app/os/        ROLA OS, the team app at rolaglobal.com/os
  www/app/api/       server routes (sign-in, OS data, inquiry form)
  www/lib/           Airtable, sessions, roles and permissions

Vercel settings that must exist (Production and Preview):
  AIRTABLE_BASE_ID     appCmpvREM4pWbpsu  (the ROLA OS base)
  AIRTABLE_API_KEY     Airtable token, read+write, ROLA OS base only
  OS_SESSION_SECRET    32+ random characters (openssl rand -base64 48)

push.sh still deploys everything. Vercel builds Next.js automatically.
