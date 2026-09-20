# Free Fire Tournament Website

A responsive tournament leaderboard with a Free Fire-inspired visual style, public read-only standings, one admin login, automatic ranking, and server-side saved data.

## Features

- Public standings page: `/`
- Admin dashboard: `/admin`
- One configured admin account only
- Add, edit, delete teams
- Change points at any time
- Automatic rank sorting by points (highest first)
- Automatic tie-break: team name alphabetically when points are equal
- Tournament title, subtitle, and status editor
- Data saved to `data.json`
- Automatic public refresh every 5 seconds
- JSON backup download from the admin dashboard
- No database service required for a basic deployment

## Set the admin ID and password

Before starting the server, set these environment variables.

Windows PowerShell:

```powershell
$env:ADMIN_ID="your_admin_id"
$env:ADMIN_PASSWORD="your_strong_password"
npm start
```

Windows CMD:

```cmd
set ADMIN_ID=your_admin_id
set ADMIN_PASSWORD=your_strong_password
npm start
```

Linux/macOS:

```bash
ADMIN_ID="your_admin_id" ADMIN_PASSWORD="your_strong_password" npm start
```

The current code falls back to `admin` / `CHANGE_THIS_PASSWORD` only so the demo can start. Change it before public deployment.

## Local use

1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Set `ADMIN_ID` and `ADMIN_PASSWORD`.
4. Run `npm start`.
5. Open `http://localhost:3000/` for the public page.
6. Open `http://localhost:3000/admin` for admin login.

## Persistence note

The standings are written to `data.json`, so they survive normal server restarts. On hosting, use a service/storage setup that preserves the application's filesystem (a persistent disk/volume). Some free serverless hosts use temporary filesystems; on those platforms, use a hosted database or persistent volume instead.

## Security note

The admin session uses an HttpOnly cookie and server-side session storage. For a public deployment, use HTTPS and set a strong admin password.
