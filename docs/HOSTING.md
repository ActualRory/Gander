# An Idiot's Guide to Hosting Gander

This guide gets your Gander server running on a local Ubuntu machine and your friends connected to it.
As an idiot, I had this written to keep me on-track during initial deployment. I'll likely only deploy a few more times before switching to automatic updates.
As which point, I'll hopefully remember to revise this guide for a final time.

---

## What you'll end up with

- A Gander server running on your Ubuntu machine, always on
- Port forwarding so friends outside your house can connect
- A Windows installer your friends download and run

---

## Part 1 — Set up your Ubuntu server

### Step 1 — Install Docker

SSH into your Ubuntu machine (or sit in front of it) and run these commands one at a time:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Then add yourself to the docker group so you don't need `sudo` every time:

```sh
sudo usermod -aG docker $USER
newgrp docker
```

Verify it worked:

```sh
docker run hello-world
```

You should see "Hello from Docker!".

---

### Step 2 — Get the Gander code

```sh
git clone https://github.com/YOUR_USERNAME/gander.git
cd gander
```

Replace `YOUR_USERNAME` with your actual GitHub username.
Make sure you have added your SSH public key to your GitHub account.

---

### Step 3 — Create your secrets file

```sh
cp .env.production.example .env
nano .env
```

You'll see this:

```
POSTGRES_PASSWORD=change-me
JWT_SECRET=change-me-long-random-string
LIVEKIT_API_KEY=prodkey
LIVEKIT_API_SECRET=change-me-livekit-secret
LIVEKIT_PUBLIC_URL=ws://your-server-ip:7880
```

Replace the `change-me` values with real secrets. To generate secure random strings, run:

```sh
openssl rand -hex 32
```

Run that command **twice** — once for `POSTGRES_PASSWORD` and once for `JWT_SECRET`. Pick any long random string you like for `LIVEKIT_API_SECRET`.

For `LIVEKIT_PUBLIC_URL`, use the same public IP you found with `curl ifconfig.me`, on port 7880:

```
LIVEKIT_PUBLIC_URL=ws://81.152.44.201:7880
```

This is the address the client app uses to connect to the voice server. It must be reachable from outside your network, so use your public IP (not `192.168.x.x`).

**Important:** `LIVEKIT_API_KEY` must stay as `prodkey` (it matches the key name in `livekit.prod.yaml`). Only change the secret, not the key name.

Save and close: `Ctrl+X`, then `Y`, then `Enter`.

---

### Step 4 — Update the LiveKit config with your secret

Open `livekit.prod.yaml`:

```sh
nano livekit.prod.yaml
```

Change `replace-with-your-livekit-secret` to the same value you put in `LIVEKIT_API_SECRET` in your `.env` file:

```yaml
keys:
  prodkey: YOUR_LIVEKIT_API_SECRET_HERE
```

Save and close.

---

### Step 5 — Start the server

```sh
docker compose up -d --build
```

This will take a few minutes the first time — it's downloading and building everything.

Check that it started:

```sh
docker compose ps
```

All three services (`postgres`, `livekit`, `server`) should show as `running`.

Check the server is alive:

```sh
curl http://localhost:3000/health
```

You should get: `{"ok":true}`

---

### Step 6 — Find your machine's local IP address

```sh
ip addr show | grep "inet " | grep -v 127.0.0.1
```

It'll look something like `192.168.1.42`. Write this down — you'll need it for port forwarding.

---

## Part 2 — Port forwarding on your router

Your friends are connecting from the internet, so you need to open holes in your router's firewall.

### Ports to forward

| Port(s) | Protocol | What it's for |
|---|---|---|
| 3000 | TCP | Gander API + WebSocket (chat) |
| 7880 | TCP | LiveKit signalling (voice setup) |
| 7881 | TCP | LiveKit RTP (voice data) |
| 50000–50100 | UDP | LiveKit WebRTC media (actual voice) |

### How to do it (generic steps — every router is slightly different)

1. Open a browser and go to your router's admin page. Usually `http://192.168.1.1` or `http://192.168.0.1`. Your router's address is printed on the bottom of the device.
2. Log in. Default credentials are also on the bottom of the router.
3. Find the **Port Forwarding** section. It might be under "Advanced", "NAT", "Firewall", or "Virtual Servers".
4. For each row in the table above, create a port forwarding rule:
   - **External port:** the port number (or range)
   - **Internal IP:** your Ubuntu machine's local IP (e.g. `192.168.1.42`)
   - **Internal port:** same as external
   - **Protocol:** as listed above
5. Save. You may need to reboot the router.

### Find your public IP address

On your Ubuntu machine:

```sh
curl ifconfig.me
```

That's the address you'll give to friends. Write it down.

---

## Part 3 — Release the Windows client

Here's what's actually happening in this part, so it makes sense:

The Gander client is a Windows desktop app. You don't send your friends the source code — you send them a compiled installer (`.exe`). Building that installer is done automatically by **GitHub Actions**, which is a free service that GitHub provides. Every time you push a version tag (like `v0.1.0`) to GitHub, Actions spins up a Windows virtual machine in the cloud, compiles the app, and attaches the finished installer to a **GitHub Release** — a download page on your repo. Your friends then grab the installer from there.

Before that build happens, you need to tell the app which server to connect to, because that address gets baked into the compiled app.

---

### Step 1 — Tell the client where your server is

The client needs to know your server's public IP address **at build time** so it's baked into the installer. You do this by creating a small config file.

On your Windows machine, open the Gander repo folder and create a file at `apps/client/.env.local` with this content:

```
VITE_API_URL=http://YOUR_PUBLIC_IP:3000
```

Replace `YOUR_PUBLIC_IP` with the public IP you wrote down from Part 2 (the one from `curl ifconfig.me` on your Ubuntu machine). For example:

```
VITE_API_URL=http://81.152.44.201:3000
```

This file is read by Vite (the build tool) when it compiles the app. It's in `.gitignore` so it won't accidentally get committed to a public repo — but you **do** need to commit it here so GitHub Actions can see it during the build.

> **If your public IP changes later:** Your ISP can change your public IP address at any time (this is called a "dynamic IP"). If that happens, your friends' clients will stop being able to connect. The fix is either to redo this step and release a new version, or — better — sign up for a free DDNS service like [DuckDNS](https://www.duckdns.org/). DuckDNS gives you a hostname like `yourname.duckdns.org` that always points to your current IP. You'd then use that hostname instead: `http://yourname.duckdns.org:3000`.

---

### Step 2 — Commit the config file

Open a terminal in your Gander repo folder and run:

```sh
git add -f apps/client/.env.local
git commit -m "set server URL for release"
```

The `-f` flag is required because `.env.local` is listed in `.gitignore` by default (to stop secrets being committed by accident). Here you're deliberately committing it so GitHub Actions can read it during the build.

This saves the server address into git so the build can use it.

---

### Step 3 — Pick a version number and tag it

Version numbers follow the format `v0.1.0`. You can use whatever numbers you like — just bump them each time you release (e.g. `v0.1.0`, then `v0.2.0`, etc.).

```sh
git tag v0.1.0
```

A **git tag** is just a label that points to your current commit. The GitHub Actions build is set up to trigger whenever a tag starting with `v` is pushed — that's the mechanism that kicks off the build.

---

### Step 4 — Push everything to GitHub

```sh
git push && git push --tags
```

The first `git push` sends your commits. The second sends the tag. Both are needed.

---

### Step 5 — Watch the build

1. Go to your GitHub repo in a browser.
2. Click the **Actions** tab near the top.
3. You'll see a workflow called **Release** with a spinning yellow circle — that means it's running.
4. Click on it to watch the progress. It takes around 10 minutes because it has to compile Rust code.
5. When the circle turns green, it's done. If it turns red, click into it to see the error log.

---

### Step 6 — Find the installer

1. On your GitHub repo, click the **Releases** link (on the right side of the main page, or go to `github.com/YOUR_USERNAME/gander/releases`).
2. You'll see your new release (e.g. `v0.1.0`) with two files attached:
   - `Gander_0.1.0_x64-setup.exe` — the installer (recommended, use this one)
   - `Gander_0.1.0_x64_en-US.msi` — alternative installer format
3. Copy the link to the `.exe` file and send it to your friends.

---

## Part 4 — What your friends do

1. Download the `.exe` installer from the Releases page on your GitHub repo.
2. Run it. Windows might warn "Unknown publisher" — click **More info → Run anyway**. (This is normal for unsigned apps.)
3. Open Gander.
4. On first launch, it asks for a **Server URL**. They enter: `http://YOUR_PUBLIC_IP:3000`
5. Click Connect, then register an account.
6. Done.

---

## Keeping the server running after reboots

By default Docker containers stop when the machine reboots. The `restart: unless-stopped` in `docker-compose.yml` handles this — but Docker itself needs to be set to start on boot:

```sh
sudo systemctl enable docker
```

That's it. Docker and all three Gander containers will start automatically on boot.

---

## Updating the server later

When you push a new server release:

```sh
cd gander
git pull
docker compose build server && docker compose up -d
```

Migrations run automatically on startup.

---

## Troubleshooting

**`curl http://localhost:3000/health` returns nothing**
```sh
docker compose logs server
```
Look for error messages. Most common causes: wrong `DATABASE_URL`, migration failure on startup.

**Voice disconnects mid-call / users report random voice drops**
See [VOICE-TROUBLESHOOTING.md](VOICE-TROUBLESHOOTING.md) — the client logs every
voice connect/reconnect/disconnect with a reason to the webview console, and that
doc maps each reason to a cause and fix.

**Voice doesn't work / "could not establish signal connection"**
- Check that `LIVEKIT_PUBLIC_URL` in your `.env` is set to your public IP on port 7880 (e.g. `ws://81.152.44.201:7880`), not `localhost` or an internal Docker hostname.
- Check that TCP port 7880 is forwarded and the firewall allows it (see `sudo ufw allow 7880/tcp`).
- Check that UDP ports 50000–50100 are actually forwarded. UDP is easy to miss — make sure you set the protocol to UDP (not TCP) for that range.

**Friends can't connect at all**
- Confirm port 3000 TCP is forwarded
- Confirm your public IP hasn't changed: `curl ifconfig.me`
- Check that the Ubuntu firewall isn't blocking it: `sudo ufw status`. If UFW is active, run:
  ```sh
  sudo ufw allow 3000/tcp
  sudo ufw allow 7880/tcp
  sudo ufw allow 7881/tcp
  sudo ufw allow 50000:50100/udp
  ```

**"Unknown publisher" warning on the installer**
Normal. Click More info → Run anyway. This happens because the app isn't signed with a paid code-signing certificate.
