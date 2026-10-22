# Mii Hub Paintball server

Everyone's Mii Hub connects to **one** of these servers to find lobbies (**Find Lobby**) and
host them (**Host Lobby**). Players never open ports or type addresses: the server's address is built
into Mii Hub. Only the server itself has to be reachable from the internet, and with **Tailscale
Funnel** (below) even that needs no router changes.

It also hosts **online chess** games (see `chess-rooms.js`; it uses the chess rules in `../js/chess.js`, so run it from a full copy of the repository).

It's tiny: almost no processor or memory, and about 20–40 KB/s of internet per player in a match.

**Two ways to run it** (pick one):

- **A) On your own always-on computer, with Tailscale Funnel** (recommended): free, no port forwarding,
  never sleeps. Steps 1–5 below.
- **B) On Render.com's free plan:** nothing runs at home, but the free server falls asleep after
  15 minutes without players, so the first person to open Online waits up to a minute for it to
  wake. See *Option B* at the end.

---

## 1. Install Node.js (once)

Download the **LTS** version from <https://nodejs.org> and install it (just click
Next until it's done). To check it worked, open a terminal (on Windows: press the
Windows key, type `cmd`, press Enter) and type:

```
node --version
```

It should print something like `v22.11.0` (any version 18 or newer is fine).

## 2. Get the server files

The server is the `server` folder in the Mii Hub repository. Either:

- **With Git:** `git clone https://github.com/sneekyedd/mii-hub.git`, then the files are in `mii-hub/server`, or
- **Without Git:** on GitHub, click **Code → Download ZIP**, unzip it, and use the `server` folder inside.

Put it anywhere, e.g. `C:\MiiHubServer`.

## 3. Start it

- **Windows:** double-click **`start-server.bat`**. The first time it installs what it needs (a few seconds).
- **Mac / Linux:** in a terminal, `cd` into the folder and run `./start-server.sh`.

You should see:

```
Mii Hub Paintball server listening on port 8787 (max 8 players a room)
```

Leave that window open while people are playing.

**Check it works:** on that computer, open <http://localhost:8787> in a web browser.
It should say *"Mii Hub Paintball server is running."*

> If Windows shows a **"Windows Defender Firewall has blocked some features"** box,
> tick **Private networks** (and **Public networks** only if you're on a public network)
> and click **Allow access**. That lets other computers connect.

## 4. Put it on the internet with Tailscale Funnel (no ports to open)

[Tailscale](https://tailscale.com) is free. *Funnel* gives this computer a permanent public web
address and passes visitors through to the server. It only makes outgoing connections, so you don't
touch your router.

1. Install Tailscale on the server computer from <https://tailscale.com/download> and sign in
   (a Google/Microsoft/GitHub account is fine).
2. Open a terminal **as administrator** (Windows: press the Windows key, type `cmd`, right-click
   *Command Prompt* → *Run as administrator*) and run:

   ```
   tailscale funnel --bg 8787
   ```

   The first time, it prints a link to turn on HTTPS and Funnel for your account: open it, click
   the buttons to allow it, then run the command again.
3. It prints your public address, something like:

   ```
   https://your-computer.your-tailnet.ts.net
   ```

   Check it: open that address in a browser on **any** device (your phone on mobile data is a good
   test). It should say *"Mii Hub Paintball server is running."*

`--bg` keeps Funnel on, even after restarting the computer. (To turn it off: `tailscale funnel --bg off`.)
Your friends **don't** need Tailscale.

## 5. Tell Mii Hub where it is

So that everyone's Mii Hub finds the server by itself, the address is built into the app **from a
private GitHub secret**: it's never written in the code, so it doesn't show up on GitHub.

1. On GitHub, open the Mii Hub repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**. Name: `PAINTBALL_SERVER`. Secret: your address
   (e.g. `https://your-computer.your-tailnet.ts.net`). Click **Add secret**.
3. The next Mii Hub update has it built in.

(Anyone who has the app could still dig the address out of it: every player's game has to know where
to connect. It's just not posted in the repository.)

Until then, or to use a different server: **🎯 Paintball → 🌐 Online → Server** → paste the
address → **Connect** (Mii Hub turns `https://` into the right `wss://` address for you).

## Settings

Set these before starting (e.g. on Windows: `set PORT=9000` then `node paintball-server.js`):

| Setting | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | which port the server listens on |
| `MAX_PLAYERS` | `8` | most players in one room (2–16) |
| `DATA_DIR` | `server/data` | where accounts and cloud saves are kept |
| `MAX_ACCOUNTS` | `5000` | most accounts the server will create |

## Accounts and cloud saves

The server also keeps Mii Hub accounts: players sign in with a username and password and their
worlds (Miis, homes, progress) follow them to any device. Everything is saved as plain files in
the `data` folder next to `paintball-server.js` (or `DATA_DIR`). Passwords are only kept as
salted scrypt hashes. **Back that folder up now and then**: it *is* everyone's saves. It's
never put in Git.

On Render's free plan the disk is wiped whenever the server restarts, so accounts would
disappear. Run it at home (Option A), or give Render a persistent disk and point `DATA_DIR` at it.

## Keeping it running

- The window has to stay open. If the server computer restarts, start it again.
- **Windows, start automatically:** press Windows+R, type `shell:startup`, Enter, and put a
  shortcut to `start-server.bat` in that folder.
- **Linux, always on:** use a systemd service or `pm2` (`npm i -g pm2`, then `pm2 start paintball-server.js --name paintball` and `pm2 save`).

## Updating

When Mii Hub gets an update that changes online play, the server may need updating too
(Mii Hub will say *"different versions"* when you connect). Get the new `server` folder the same
way as before (`git pull`, or download the ZIP again) and restart it.

## How the game uses it (for the curious)

- Players send their position ~30 times a second; the server passes it on.
- When you hit someone, *your* game decides the hit (what you saw is what you get) and tells
  the server. The server checks it's believable (real damage numbers, not faster than the gun
  can fire, knife hits only up close), takes the HP off, and tells everyone.
- Respawn mode: 2 s after being splattered you come back; first to **20** eliminations wins,
  or whoever has the most after **10 minutes**.
- The messages are described at the top of `paintball-server.js`. `npm test` runs the server's tests.

## Option B: Render.com (free, nothing at home)

1. Make a free account at <https://render.com> (sign in with GitHub).
2. **New → Blueprint**, pick the `mii-hub` repository (and the branch with the latest Mii Hub). Render
   reads `render.yaml` from the repository and sets the server up by itself. Click **Apply**.
3. When it's live, Render shows its address (`https://….onrender.com`). That's the address for
   step 5 above.

The free plan sleeps after 15 minutes with nobody connected; Mii Hub shows *"Waking up the Paintball
server…"* while it starts again (up to a minute).
