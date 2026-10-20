# Mii Hub

A 3D web app where your Miis walk around, chat and become friends, a bit like the Mii plaza in the Wii's Mii Channel. The style is inspired by Tomodachi Life: soft cartoon shading, bright colors and rounded shapes. Everything is 3D: the Miis, the island park, the office, the moon base, the apartments and each Mii's home.

## How to run it

### Option 1: Install the desktop app (recommended)

1. Go to the **[latest release](https://github.com/sneekyedd/mii-hub/releases/latest)**.
2. Under **Assets**, download the file for your computer:
   - **Windows:** `Mii-Hub-Setup-….exe`. Run it to install. If Windows says *"Windows protected your PC"*, click **More info** → **Run anyway**.
   - **Mac:** `Mii-Hub-…-mac.dmg`. Open it and drag **Mii Hub** into **Applications**. The first time, right-click the app → **Open** → **Open**. If macOS still blocks it, go to **System Settings → Privacy & Security** → **Open Anyway**.
   - **Linux:** `Mii-Hub-…-linux.AppImage`. Make it executable (`chmod +x`), then double-click it.
3. Open **Mii Hub** from your desktop or Start menu / Applications folder.

The warnings appear because the app isn't signed with a paid developer certificate. They're normal for small hobby apps.

**Updates are automatic.** Once Mii Hub is installed, you never need this page again. A few seconds after it starts (and every few hours), it checks for a newer version and asks if you'd like to update:
- **Windows and Linux:** click **Update now**. It downloads in the background, then offers to restart into the new version. If you pick **Later**, it updates the next time you close Mii Hub.
- **Mac:** it tells you about the update and opens the download page. Apple only lets apps install their own updates if they're signed with a paid Apple developer certificate.

Your Miis and friendships are kept when you update. You can also check yourself with **Check for updates** at the bottom of the side panel. **📜 Patch notes** next to it shows what's new in your version and the history of every update. They also pop up by themselves the first time you open Mii Hub after an update.

### Option 2: Open it in a web browser

Download the project, unzip it, and double-click `index.html`. You don't need to install anything.

On first launch you'll see a few randomly generated Miis. Add your own with **Choose Mii .glb files…**, or click **Add random Miis** for more. Everything works offline: the 3D library (Three.js) and the font are included in the project.

### How the installers are made

Every time code is pushed, GitHub Actions (`.github/workflows/desktop.yml`) builds the Windows, Mac and Linux versions on GitHub's computers and publishes them as a new release. The version number comes from `"version"` in package.json: bigger updates change the middle number (1.1.0 → 1.2.0) and small ones the last (1.1.0 → 1.1.1). A version can only be released once.

To run or build the desktop app yourself, install [Node.js](https://nodejs.org), then:

```
npm install
npm start        # opens Mii Hub in its own window
npm run dist     # builds an installer for your computer into dist/
```

## Adding your own Miis

The hub uses **full-body 3D Mii models (`.glb` files)** exported from [Mii Creator](https://mii.nxw.pw).

1. In Mii Creator, export your Mii as a full-body 3D model (`.glb`).
2. In the hub, click **Choose Mii .glb files…**, or drag the files onto the 3D view.

The hub reads the Mii's name from the file. It also uses the height setting to make taller Miis a little bigger. Old `.miic` / `.mii` files no longer work, because they don't contain a 3D model.

Your Miis always look exactly like they do in Mii Creator. To change how a Mii looks, change it in Mii Creator and export it again.

**Adding a Mii with the same name as one you already have?** You'll be asked what to do:
- **Update its look:** use the new model, but keep its personality, friends, home, coins and game skills.
- **Add as a new Mii:** keep both (the new one gets a number after its name).
- **Replace it:** start fresh. The old one is removed.

## What you can do

- **Look at a place:** pick one from the places drop-down at the top left: **🌳 Park**, **🏢 Office**, **🚀 Outer Space**, **🏘️ Courtyard**, **🏖️ Beach**, **☕ Café Street**, **🎓 College** or **🎤 Concert Stage**. The number next to each is how many Miis are there right now. Switching places only moves *you*: the Miis stay where they are (see *Miis live their own lives* below).
- **Full screen:** click **⛶** in the corner of the scene (or press **F**) to make the scene fill your screen. Small place buttons stay in the corner. Press **F** or **Esc**, or click **✕**, to go back. In the desktop app, **F11** makes the whole window full screen.
- **Move the camera:** drag the background to spin all the way around, and scroll (or pinch) to zoom. Every place has scenery all the way round. In the office and in homes, the wall between you and the room hides itself, like a dollhouse.
- **Click a Mii** (left button) to make it jump and say hi. **Drag a Mii** to pick it up and carry it. Let go and it drops back down.
- **Right-click a Mii** to open its menu:
  - **Quick actions:** wave, dance, jump, nap, or say its catchphrase.
  - **Play a game** (see *Mini-games* below).
  - **Personality:** five sliders. *Calm ↔ Energetic*, *Shy ↔ Outgoing*, *Quiet ↔ Chatty*, *Serious ↔ Silly* and *Grumpy ↔ Sweet* change how it moves, how often it talks and starts conversations, what it does with friends, and what it says. Each Mii gets a Tomodachi-style label like "Lively Joker" or "Quiet Sweetheart".
  - **Name and catchphrase:** rename it, and give it a catchphrase it says now and then.
  - **Best friends:** see who it gets along with.
  - **Go to…:** send the Mii to the park, the office, the moon, the apartment courtyard or home. It stays there a good while before deciding for itself again.
  - **Favorite place:** where it likes to be most (picked from its personality at first; change it any time).
  - **🏠 Send home**, **🏡 Visit home** and **📦 Move away** (see below).
- In the **Residents** list, click a Mii's picture or name to open its menu. The 🪙 number is how many coins it has.
- **How chatty?** sets how often Miis talk and hang out.

Your Miis, their homes, coins, friendships and the place you picked are saved, so they'll still be there next time.

**🎵 Music:** a song plays in the background and loops smoothly (it plays everywhere except Paintball). The 🎵 button at the top turns it on or off.

## Homes and coins

Every Mii has its own apartment in the building by the **🏘️ Courtyard**. You can see its name by its door, and its windows light up when it's home. The building starts with 3 floors of 4 apartments. When every apartment is taken, it gets a new floor (up to 10 floors, so 40 homes). A Mii who doesn't have an apartment yet can still be visited from its menu.

- **🏠 Send home:** the Mii says goodbye and walks home (in the Courtyard, it walks to its own front door). Nothing is lost: it keeps its friends, coins and everything else. Use **🚪 Invite out** in the *Residents* list to bring it out to the place you're looking at.
- **Through the windows:** in the Courtyard, the windows of Miis who are home are open, and you can see them inside doing their thing: napping, watching TV, playing games...
- **🏡 Visit:** go inside a Mii's home (from its menu, the *Residents* list, or by clicking its apartment in the Courtyard). It's just the Mii and its home: watch it nap in bed, watch TV, play games or water its plants, and it'll come over to chat with you. Click **← Leave** to go back outside.
- **🛋️ Decorate:** while you visit, buy furniture with **the Mii's own coins**: beds, seats, tables, a TV or game console, rugs, lamps, plants, wall art, special things (like a fish tank or drum kit), wallpaper and flooring. Things you've bought stay owned, so you can swap back for free. Each Mii likes different things depending on its personality, and it tells you what it thinks.
- **🍙 Give food:** every Mii has a favorite food and one it can't stand. Try things and see!
- **📦 Move away:** removes a Mii from your world for good. Everyone else reacts depending on how close they were: best friends are heartbroken, friends are sad, and strangers might not even notice.

**Coins** are earned by the Miis themselves, for *meaningful* time together, not just lots of it:
- Doing something **outside their comfort zone** is worth the most: a shy Mii walking up to someone (especially a stranger), a grumpy Mii giving a compliment, a serious Mii telling a joke, a calm Mii dancing, a quiet Mii chatting, or two Miis making up after an argument.
- Doing **the same thing with the same Mii** over and over earns less and less.
- Hanging out uses up a Mii's **social energy**, which comes back with some alone time. So turning *How chatty?* all the way up doesn't make coins pour in.
- **Playing a mini-game with you** earns 3 coins.

## Wishes, levels and your town

Miis need you! This is what keeps the game going:

- **💭 Wishes:** every few minutes a Mii asks you for something: food (maybe a particular dish), new furniture or wallpaper, a mini-game, a visit, a trip somewhere, a high five or a trick, a new catchphrase, meeting another Mii, help making up after a fight, or advice about a crush. A Mii with a wish gets a 💭 by its name in *Residents* (and over its head). To find out what it wants, go and talk to it: its menu (right-click it, or click the 💭) shows the wish and the ways to help. Grant it before the timer runs out!
- **⭐ Mii levels:** granting wishes (and giving things a Mii loves) fills its hearts ❤️. When they're full the Mii **levels up** and you pick a present: a **special move** (spin, backflip, moonwalk, flex, bow, sing), a **song** it can sing (and use for karaoke), a **free piece of furniture**, or **coins**.
- **🏙️ Town level:** every wish you grant gives the town XP (shown in the top bar). Each new town level gives every Mii coins (10 × the new level, up to 100) and unlocks something: picnics, crushes and couples, karaoke, more festivals, rivalries, storytelling, and fancier things in the shop. Every place is open from the start.
- **📅 Daily goals:** three new goals every day (like "grant 3 wishes" or "visit 2 homes"). Each one gives town XP and coins for every Mii, with a bonus for finishing all three.
- **📖 Sticker book:** collect stickers for foods tried, furniture bought, places visited, weather and festivals seen, friendships, couples, games and town milestones.
- **💕 Relationships:** arguments can turn into real fights (the two stop talking until you help them make up). Good friends can get a **crush**; you decide whether they should confess, and it might work... or not. Couples go on dates and like to be in the same place. Miis who keep fighting become **rivals** and have contests.
- **🌦️ Weather, seasons and festivals:** the season follows the real calendar, the weather changes every few minutes (rain, storms, snow, wind, sunshine), and some days have a festival (fireworks, lanterns, cherry blossoms, a spooky night, shooting stars, winter lights). Miis talk about it, and stay indoors more when it rains.
- **🛍️ A shop that changes daily:** each day the furniture and food on sale change, with two ⭐ deals at 30% off. Fancier things unlock as your town grows. Things a Mii already owns can always be used.
- **🍙 Give food anywhere:** right-click a Mii and pick **Give food**: you don't have to visit its home.

## Miis live their own lives

Each Mii decides for itself where to be. It stays somewhere for a few minutes, then says bye, walks out (or to its front door) and heads somewhere else. Where it goes depends on its **favorite place** and its **personality**:
- **Home:** lazy, calm and shy Miis spend lots of time at home.
- **Office:** serious, hard-working Miis go to work.
- **Moon base:** energetic, adventurous Miis visit space.
- **Park:** active, outdoorsy Miis love the park.
- **Apartment courtyard:** friendly neighbors hang out in front of the building.
- **Beach:** fun-loving, energetic Miis (especially on sunny days).
- **Café Street:** chatty, sociable Miis.
- **College:** curious, studious Miis.
- **Concert Stage:** silly, energetic performers.
- **Couples** like to be in the same place, and **bad weather** keeps Miis indoors.

The *Residents* list shows where everyone is ("At the office 🏢", "On the way to the park 🌳"...). Miis in places you're not looking at still chat, become friends and earn coins, and you'll see it in *What's happening*. Click a Mii in the list to go and see it (or visit it, if it's home).

## What the Miis do

- **Walk around** and visit spots:
  - Park (a little island): sit on the benches, watch the ducks, make a wish at the fountain, have a picnic, admire the cherry blossoms, look at the sea.
  - Office (an IT help desk): staff the help desk, wait for help, work on tickets at the tech desks, check the servers, fix computers at the repair bench, hunt for spare parts, watch the ticket dashboard, plan the network on the whiteboard, make coffee, and fight the out-of-order printer.
  - Outer Space (a moon base): check the rocket, salute the flag, fix the rover, gaze at Earth, visit the space garden, admire the glowing crystals.
- **Find their own way around** trees, benches, desks, chairs, ponds and each other, and never walk on water. They slide along things they brush against, curve around Miis who are standing still, and step aside for each other in narrow spaces. If you drop a Mii in the pond, it climbs out.
- **Sit properly:** a Mii sits down on a bench (or a sofa, or lies down in bed at home), stays facing the same way while it sits, and stands up in the same spot before walking off.
- **Move like themselves:** energetic Miis take big, bouncy steps and jump about; calm ones stroll; shy ones look down and keep their hands together; grumpy ones stomp and fold their arms; silly ones waddle and bop their heads; outgoing ones stand with their hands on their hips; chatty ones talk with their hands. Dances and waves change too.
- **Act like themselves:** shy ones stammer when they meet someone new, silly ones tell more jokes, and grumpy ones argue more.
- **Give honest compliments:** they only mention things that are really true, like someone's height, their hair color, or their top (only when it's clearly one color). Nothing about beards or anything else that's hard to tell from the model.
- **Call each other over:** usually a Mii walks up to someone to talk. But if they're far apart and it's the loud, outgoing type, it shouts **"HEY MIA! COME HERE!"**, the other one shouts back **"COMING!"** and walks over, and then they talk face to face.
- **Phone friends who are somewhere else:** a Mii takes out its phone, and a tag shows who it's talking to ("📱 Calling Mia" or "📱 Call from Mia"). You see what the other Mii says coming out of the phone in a blue bubble.
- **Talk now and then.** Some lines depend on the place they're in.
- **Meet up in pairs** and:
  - chat
  - tell jokes
  - give compliments
  - high-five
  - play rock-paper-scissors
  - have a dance party
  - argue about pizza and then make up
  - in space, hold moon-jump contests
- **Build friendships** over time, from *Strangers* to *Best Friends* 💖. You can see each Mii's friendships in its menu (right-click it), and news in the *What's happening* panel.
- **In space**, Miis wear astronaut helmets and float in low gravity.

## Mini-games

Right-click a Mii and pick a game from **Play a game** in its menu:

| Game | Format |
| --- | --- |
| ✊ Rock Paper Scissors | Best of 5 (first to 3) |
| ⭕ Tic-Tac-Toe | Best of 3 (first to 2) |
| 🔴 Connect 4 | One game, winner takes all |
| ♟️ Chess | One game (also from **🎮 Play → ♟️ Chess** at the top) |

Every Mii has a **skill meter** for each game, from *Beginner* to *Master*. **The more you play a game with a Mii, the better it gets**, and it learns a bit more from losing. Skill changes how it plays:

- **Rock Paper Scissors:** beginners pick almost at random and overuse a favorite move. Skilled Miis notice your habits and play whatever beats your next move.
- **Tic-Tac-Toe:** beginners play anywhere. Better Miis take wins and block yours. A *Master* plays perfectly and can't be beaten (only drawn).
- **Connect 4:** beginners drop pieces almost anywhere. Better Miis take wins, block yours, and think up to six moves ahead.
- **Chess:** a new Mii is a total beginner that hangs pieces. It gets better with every finished game (Master after about 20). A Master is knowledgeable with few blunders, but beatable: it's no Stockfish.

After a game, **📊 Review the game** works like chess.com's review: your accuracy, and every move rated (Book, Best, Excellent, Good, Inaccuracy, Mistake, Blunder) with the better move for your mistakes.

**🎮 Play → ♟️ Chess** at the top opens the chess window: play one of your Miis, or go **🌐 Online** to play other people through the same server as online Paintball. Host a game (optional password, a clock from bullet to classical, and your color) or join one. The server checks every move and runs the clocks. You can offer a draw, resign, or ask for a rematch.

While you play, the Mii stops what it's doing and faces you. It chats during the game in its own personality, and celebrates or sulks afterwards.

## 🎯 Paintball

A first-person shooter on **Shipment** (from Call of Duty 4), made to feel like **CS:GO / Valorant**. Click **🎮 Play → 🎯 Paintball** in the top bar (or pick Paintball in a Mii's **Play a game** list). Paintball is its own part of the game: its files only load when you open it, so it doesn't slow down starting Mii Hub.

- **🤖 VS a Mii:** pick the Mii you play as and the Mii you play against.
  - **Respawn** (the default): 2 seconds after you're splattered you're back in. **First to 20 eliminations wins** (or whoever has the most after 10 minutes).
  - **Rounds:** first to 10 rounds. Each round has 3 seconds of freeze time, then 1:30 to splat the other Mii.
- **🌐 Online:** play against other people. Everyone picks one of the Miis from their own Mii Hub, and the others see it. Nobody has to open ports or type addresses.
  - **Find Lobby:** a list of everyone who's hosting: the lobby's name, the host, how many players, and 🔒 if it needs a password. Click **Join**.
  - **Host Lobby:** give it a name, an optional password (leave it empty for anyone to join) and how many players (2–8). Your lobby shows up in everyone's list.
  - **In a lobby** you're straight onto the map: run around freely until someone else joins, then the match starts by itself. Online modes: **Respawn** (first to 20) and **Rounds** (no respawning: the last one standing wins the round, first to 7).
  - **Between matches** there's a 15-second vote for the next mode (and map, when there are more). A tie is picked at random. If everyone else leaves, you're back to running around until someone joins.
  - Everyone meets on the Mii Hub Paintball server: see **[server/README.md](server/README.md)** for how it's set up.
- **You see the world through your Mii's eyes**, with its Mii hands and shirt color holding the gun.
- **The HUD** shows your HP, your paint (ammo), the clock and score, and a kill feed. Hold **Tab** for the scoreboard (score, kills, deaths, headshot %, damage, accuracy, and ping online).
- **Weapons:** a paintball gun shaped like an **AK-47** and a **butterfly knife**.
  - The gun works like CS:GO's AK: 600 shots a minute, a 30-round magazine, a 2.43-second reload. **One headshot splats a Mii.** It takes 3 chest shots or 4 leg shots.
  - Stand still and your first few shots go right where you aim. Running makes you very inaccurate, and holding the trigger follows the AK's spray pattern: up, then left, then right. Counter-strafe (tap the opposite key) to stop quickly before you shoot.
  - **🦅 Paint Deagle** (key **2**): a sidearm in both classes, like CS:GO's Desert Eagle. One shot per click, 7 shots then a 2.2-second reload, and it loses damage over distance. Up close a headshot splats a Mii and two chest shots do. Wait a moment between shots, standing still, for the first one to be dead-on.
  - **Loadouts:** before you spawn (and whenever you press **B**) pick **1 · Rifler** (Paint AK + Deagle + knife) or **2 · Sniper** (Paint AWP + Deagle + knife). Before the match or round starts you switch right away. Otherwise you get it on your next spawn.
  - The **AWP** works like CS:GO's: right click zooms in (twice, then out), one shot to the chest or head splats a Mii, 10 shots then a 3.7-second reload, and a bolt pull after every shot (about 1.5 s) that takes you out of the scope. Shooting without scoping ("no-scoping") is very inaccurate. You move slower with it, and even slower scoped in.
  - **Moving shots miss, like CS:** running or jumping with the AK sends your shots almost anywhere in a wide circle. With the AWP scoped in, moving at all makes it inaccurate and blurs the scope's crosshair; stand still for a clean shot.
  - **Crates & Locker** (in the Paintball lobby): earn 🎨 credits by playing (kills, headshots, round wins, finishing and winning matches; new players start with 200) and open a **Splat Case** for 100. There are 50 skins inspired by CS, from Mil-Spec (blue, 79.92%) through Restricted (purple), Classified (pink) and Covert (red) to Rare Special (gold, 0.26%), which is always a Butterfly Knife. Trade up 10 of the same skin for one from the next tier. Equip skins in the Locker. Other players see your skins online.
  - The knife: left click slashes, right click stabs. Hitting someone in the back does a lot more damage. You run faster with the knife out.
- **Movement is CS:GO's:** the same speeds, friction and jump height, Shift to walk quietly, Ctrl or C to crouch, and air strafing. Running makes footsteps others can hear. Walking doesn't.
- **The Mii opponent plays by the same rules as you.** It hunts you down, follows your footsteps and gunshots, stops before it shoots, sprays and taps depending on how far away you are, and controls its recoil. **Its Paintball skill decides how good it is.** It gets better every time it wins or loses a fight with you.
- **Settings:** mouse sensitivity (the same numbers as CS), **field of view** (60–150, like CS's: 90 is normal), volume, and crosshair color, size, gap and style. Press **Esc** for the menu (offline it pauses; online the match keeps going).

| Key | What it does |
| --- | --- |
| W A S D | move |
| Mouse | aim · left click shoot / slash · right click knife stab |
| Space | jump |
| Shift | walk (quiet) |
| Ctrl or C | crouch |
| R | reload |
| 1 / 2 / 3 | gun / Deagle / knife |
| Q, mouse wheel | switch weapons (Q: back to your last one) |
| Right click (AWP) | zoom the scope |
| B | loadout (1 Rifler · 2 Sniper) |
| F | inspect your weapon |
| Tab | scoreboard |
| Esc | pause |

- **Courtyard:** a courtyard in front of the apartment building, where every Mii has a home.

## About the random Miis

The random Miis (and the ones from **Add random Miis**) are built from the one bundled Mii model, with random colors, names, personalities and catchphrases. They share a face shape and hairstyle. Add your own `.glb` Miis for a crowd with different faces, and use **📦 Move away** to remove random ones.

## What's in each place

- **Park:** an island in the sea, with:
  - round trees, an apple tree, an orange tree and a cherry blossom
  - palm trees and a white picket fence
  - a duck pond with ducklings, lily pads and reeds
  - a three-tier fountain, swings, a picnic blanket, lamp posts and flower beds
  - butterflies, seagulls, sailboats, and clouds and islands all the way round (a village, a mountain, rock arches, a lighthouse...)
- **Office (IT help desk department)** on the top floor of a tower, with real windows looking out over a sunny city (Miis like to gaze out of them):
  - a help desk counter with a "Now serving" ticket display, a take-a-number machine and a waiting area
  - tech desks with dual monitors, PC towers, headsets and a debugging rubber duck
  - a server room with blinking server racks, a cable tray and a raised floor
  - a repair bench with an opened-up PC, a laptop, tools and a pegboard
  - spare-parts shelving, stacked laptop boxes, a cart of monitors, and a live ticket dashboard TV
  - a rolling whiteboard with a network diagram, an "OUT OF ORDER" printer, e-waste bins, IT posters, and a break area
- **Outer Space:**
  - a glass dome with a garden inside, a rocket on a launch pad with blinking lights, and a launch tower
  - solar panels, a turning satellite dish, a rover and glowing crystals
  - a waving flag, Earth with moving clouds, and a UFO that zooms past now and then
  - moon hills and craters all the way round, more planets and moons, a turning space station, satellites and a comet

## If a Mii doesn't animate

The hub finds the arm, leg, spine and head bones in each `.glb` file:
- **Mii Creator names** like `Arm_1_L`, plus names used by other tools (Mixamo, Blender, VRM...).
- **T-poses:** arms held straight out to the side are straightened to hang down.
- **Built-in animations:** if the file has its own idle/walk animations, those are used.
- **No skeleton:** models without one (like a "head only" export) hop along instead of walking, and get a ⚠ note in the Residents list. Re-export them from Mii Creator as **Full body**.

## How the animation works

The `.glb` from Mii Creator has a skeleton (bones for the arms, legs, spine and head) but no built-in animations. The hub moves those bones itself every frame to make the Miis walk, wave, cheer, dance, type and sit (see `Rig.pose` in `js/miiModel.js`).

## Project layout

```
index.html            the page
css/style.css         how the page looks
js/vendor/            Three.js 3D library (r147, MIT licence)
js/miiModel.js        loads .glb Miis, recolors them, moves their bones
js/world3d.js         the 3D island park, office and moon base
js/nav.js             route-finding, so Miis walk around obstacles
js/dialogue.js        what Miis say and the activities they do together
js/minigames.js       mini-game rules, the Mii opponents, and skill growth
js/gamesUI.js         the window where you play a mini-game with a Mii
js/hub3d.js           moves the Miis around, camera, clicking & dragging, home visits, coins
js/homes.js           furniture, food, and what each Mii likes
js/town.js            where each Mii is, and where it wants to go next
js/progress.js        wishes, Mii levels, town level, daily goals, stickers, relationships, weather, the shop
js/weather3d.js       rain, snow, falling leaves, fireworks and other festival effects
js/places-seaside.js  the beach and Café Street
js/places-town.js     the school and the concert stage
js/homes3d.js         the apartment building and the inside of each home
js/paintball/         Paintball (only loaded when you open it):
  pb-engine.js          movement, the AK and knife rules, hit boxes and the Mii's brain
  pb-map.js             the Shipment map
  pb-models.js          the paint AK and AWP, the butterfly knife, your Mii hands and how skins are drawn
  pb-skins.js           the skin catalog (rarities, odds, trade-ups)
  pb-crates.js          credits, crates, the opening reel and the Locker
js/music.js           the background music (loops between exact points; the song is in js/hubMusic.js)
js/chess.js           chess rules and the Mii chess brain
js/chessUI.js         the chess board and windows
js/chessOnline.js     online chess (through the Paintball server)
  pb-audio.js           sound effects
  pb-game.js            the lobby, the match, the HUD and the scoreboard
  pb-online.js          online play: Find Lobby, Host Lobby, passwords
server/               the online Paintball server everyone meets on (see server/README.md)
render.yaml           sets the server up on Render.com (one of the two ways to run it)
js/storage.js         saves Miis in the browser
electron/main.js      runs Mii Hub as a desktop app (Electron)
electron/updater.js   checks GitHub for new versions and installs them
electron/preload.js   lets the page show the version and "Check for updates"
js/patchNotes.js      the patch notes (newest first) and the patch notes window
build/icon.png        the app icon
fonts/                the Nunito font (works offline)
package.json          desktop app settings (version, installers)
js/app.js             connects buttons and side panels to the hub
js/sampleGlb.js       Joe.glb stored as text so it loads without a web server
samples/Joe.glb       the sample Mii
tests/glb.test.js     checks that .glb files are read correctly
tests/nav.test.js     checks that routes go around obstacles and water
tests/minigames.test.js  checks the game rules and that skill really changes how Miis play
tests/homes.test.js   checks the shop items, tastes and far-away conversations
tests/progress.test.js   checks wishes, levels, town level, goals, relationships and the shop
tests/paintball.test.js  checks Paintball movement (speeds, jump, walls, steps), damage, hit boxes and recoil
```

## Running the tests

If you have [Node.js](https://nodejs.org) installed:

```
npm test
```

## Ideas for adding your own stuff

- **New lines for Miis to say:** add them to `lines` in `js/world3d.js` or `SOLO_LINES` in `js/dialogue.js`.
- **New activity for two Miis:** add a function to `interactions` in `js/dialogue.js`, then add its name to `choices` in `buildInteraction`.
- **New place:** write a `buildSomething()` function in `js/world3d.js` (copy one of the others), and add it to `builders` and `list` at the bottom.
- **New object Miis should walk around:** add its shape to that place's `obstacles` list (circle, oval or rectangle — see the top of `js/nav.js`).
- **New pose:** add a case to the `switch (p.arms)` in `js/miiModel.js`.
- **New furniture or food:** add it to `ITEMS` or `FOODS` in `js/homes.js`, and (for furniture) its 3D model in `js/homes3d.js`.
