# MiiNSCC

MiiNSCC is an office board you can watch. Everyone at work is a little 3D Mii in one
shared office. When you're at work, your Mii sits at a desk and types, gets a coffee now
and then, stretches, and sometimes has a quick friendly chat with someone.

When you head out, type where you're going ("Lunch", "Client visit", "Dentist"...).
Your Mii gets up, walks out of the door, and shows up in the **top bar** with your face,
your name, where you are, and the time you left. Clear the text when you're back and your
Mii walks back in and goes back to work.

At **6:00 PM** everyone still in the office walks out and the board is cleared for the
day. Tomorrow, everyone adds their Mii again with one click (it remembers them).

It's made to be shown on a TV in the office (big, easy to read), and to be opened on
anyone's own computer too. It's a plain website: no app to install, no server (yet).

## Run it

Any of these work:

- **Best: double-click `Start MiiNSCC.bat`** (Windows) or `start-miinscc.sh` (Mac/Linux).
  It quietly downloads the newest version first (no questions asked), then opens MiiNSCC
  in your browser. This needs the folder to have been downloaded with `git clone`; with no
  internet it just opens the copy you have.
- **Just open it:** double-click `index.html` (it opens in your web browser, but doesn't update itself).
- **Small local web server** (from this folder):
  - `npx serve` and open the address it prints, or
  - `python3 -m http.server 8080` and open http://localhost:8080
  - `npm start` does the same as `npx serve`.

Everything it needs is in this folder (the 3D library and the font too), so it also works
without internet.

## How to use it

1. **Open the page.** A window asks "Who's coming in?":
   - click a **saved Mii** (anyone added on this computer before), or
   - **upload a new Mii**: a full-body 3D Mii **.glb** file exported from Mii Creator
     (you can also drag the file onto the page). There's a sample Mii to try it out.
   The Mii walks in through the door and goes to a desk.
2. **Add more** any time with the **+ Add Mii** button (top right).
3. **Going out?** Click your Mii (anyone can change anyone's). Type where you are and
   press **Enter** (or pick one of the quick buttons). Your Mii walks out of the door.
4. **Back?** Click your name in the top bar, clear the text (or press "I'm back in the
   office"). Your Mii walks back in.
5. **6:00 PM:** everyone leaves and the board is empty until the next day. A Mii added
   after 6 PM stays until midnight.

You can spin the camera a little by dragging, and zoom with the mouse wheel.

Trying out the 6 PM rule without waiting: open `index.html?now=2026-10-28T17:59:30` (any
date and time). The page then pretends it's that time.

## Where things are

| What | File |
| --- | --- |
| The page | `index.html`, `css/style.css` |
| **The office (placeholder, swappable)** | `js/nscc/office.js` |
| **All shared state (the store)** | `js/nscc/store.js` |
| The rules (in/out, 6 PM, top bar) | `js/nscc/logic.js` |
| What the Miis say (easy to add lines) | `js/nscc/chatter.js` |
| The 3D office view (walking, sitting, door) | `js/nscc/officeHub.js` |
| Buttons, windows, top bar | `js/nscc/app.js` |
| Loading and moving the Mii models | `js/miiModel.js` |
| Walking around furniture | `js/nav.js` |

### The office (`js/nscc/office.js`)

The office is a **placeholder**: simple desks, a coffee corner, a water cooler, windows and
a door. It will be replaced by the real office later. Everything about the room is in this
one file, behind one function:

```js
NSCCOffice.build(scene) -> {
  root,          // the 3D room (added to the scene)
  bounds,        // the floor area Miis can walk on
  obstacles,     // furniture to walk around
  workSpots,     // desks (to sit and type) and break spots (coffee, water, stretch...)
  doorPoint,     // just inside the door
  outsidePoint,  // just outside the door: Miis appear and disappear here
  insidePoint,   // a few steps into the room
  cameraView,    // where the camera looks, and how far it can turn
  background,
  update(t, info) // optional animations (the door opening, the wall clock)
}
```

To use a new office, write a file with the same `build()` and load it in `index.html`
instead. The details are at the top of `office.js`.

### The store (`js/nscc/store.js`)

All shared state goes through this one module: who is on today's board, each person's
location text and the time they left, and the saved Miis. Every method is async (returns
a Promise) and the store tells the page about every change (`store.on(...)`).

Right now it saves everything **in this browser**: the board in localStorage and the
saved Miis (with their .glb files) in IndexedDB. Tabs open on the same computer stay in
sync. Each computer has its own board for now.

## Planned

- **A server**, so the TV and everyone's computers share one board. The plan: a small
  WebSocket server, and a store with the same methods as `store.js` that talks to it.
  The rest of the page doesn't need to change.
- **The real office** model, replacing the placeholder in `office.js`.

## Tests

```
npm test
```

Checks the store, going out and coming back in, the 6 PM rule (also when the page is
opened again after 6 PM or the next day), the top bar, and that the Miis only make
friendly small talk.

## Thanks

3D library: [three.js](https://threejs.org) (MIT, in `js/vendor`). Font: Nunito (SIL Open
Font License, in `fonts`). Mii models come from Mii Creator.
