# MiiNSCC

MiiNSCC is an office board you can watch. Everyone at work is a little 3D Mii in our
office, **A223 Information Technology**. When you're at work, your Mii sits at its desk and
types, gets a coffee now and then, stretches, checks the servers, and sometimes has a quick
friendly chat (or a little meeting in the conference room) with someone.

When you head out, type where you're going ("Lunch", "Client visit", "Dentist"...).
Your Mii gets up, walks out of the front door and down the hallway (fading away at the end of it), and shows up in the **top bar** with your face,
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
   The Mii walks up the hallway, in through the front door, and goes to its desk.
2. **Add more** any time with the **+ Add Mii** button (top right).
3. **Going out?** Click your Mii (anyone can change anyone's). Type where you are and
   press **Enter** (or pick one of the quick buttons). Your Mii walks out of the door.
4. **Back?** Click your name in the top bar, clear the text (or press "I'm back in the
   office"). Your Mii walks back in.
5. **6:00 PM:** everyone leaves and the board is empty until the next day. A Mii added
   after 6 PM stays until midnight.
6. **Your own desk:** click your Mii and pick your desk under **Workspace**: a desk
   number, **Office A** or **Office B**, or **Any free desk** (the default). The list shows
   who already has each one. Picking one that's someone else's asks first, then you swap
   (they get your old spot, or any free desk). Your Mii goes to its own spot when it's working
   and comes back to it after breaks; Miis without one take a free desk that isn't anyone's.
   This is remembered from day to day. The desk numbers are on the desks, and the owner's
   name shows on their desk and on their office door.

You can spin the camera all the way round by dragging and zoom with the mouse wheel; **🎯 Center the office** brings it back.

7. **⚙️ Settings** (top right): check for updates (it shows the exact command to get one),
   turn the background music on or off (the same looping song as Mii Hub), and pick the
   graphics quality. Settings also shows how smoothly it's running.

Trying out the 6 PM rule without waiting: open `index.html?now=2026-10-28T17:59:30` (any
date and time). The page then pretends it's that time.

## Where things are

| What | File |
| --- | --- |
| The page | `index.html`, `css/style.css` |
| **The office (rooms, desks, the front door; swappable)** | `js/nscc/office.js` |
| **All shared state (the store)** | `js/nscc/store.js` |
| The rules (in/out, 6 PM, top bar, who sits where) | `js/nscc/logic.js` |
| What the Miis say (easy to add lines) | `js/nscc/chatter.js` |
| The 3D office view (walking, sitting, door) | `js/nscc/officeHub.js` |
| Buttons, windows, top bar | `js/nscc/app.js` |
| Loading and moving the Mii models | `js/miiModel.js` |
| Walking around furniture | `js/nav.js` |

### The office (`js/nscc/office.js`)

The office is built from the floor plan and the desk plan:

| Room | What's in it |
| --- | --- |
| **A223 Information Technology** (the big open office, left and top) | 10 numbered desks where the desk plan puts them (and facing the way it shows), a long workbench along the server room wall, the coffee corner (coffee machine, fridge, water cooler, a table and a sofa), plants, windows, a whiteboard, a printer, the wall clock and the big A223 sign |
| **E: Server room** (top right) | two rows of server racks with blinking lights, cable trays with cables overhead, a cooling unit with a turning fan, a UPS box. You get in through the storage room (a door from D) |
| **D: Storage room** (under E) | shelves with boxes, spare screens and parts bins, more boxes on the floor. Its door is on the workbench wall, facing the main room, just past the end of the workbench |
| **C: Conference room** | a table with four chairs, a screen with a slide on it, a whiteboard. Now and then two or three Miis meet there for a bit. It isn't anyone's desk |
| **B and A: private offices** | a desk with a chair (by B's left wall and by A's right wall), a guest chair, a rug, a lamp, a photo, plants; B has a bookshelf, A a cabinet, a floor lamp and a picture |
| **The hallway** (right, between D and A) | outside the office. The **front door** is where the hallway meets the open office: Miis only come in and go out that way |

Every room has a real door that swings open when a Mii walks through and closes after.
The room walls are low with glass on top, so you can see into every room from any side;
the outer walls hide while the camera is behind them. Everything about the room is in
this one file, behind one function:

```js
NSCCOffice.build(scene) -> {
  root,          // the 3D room (added to the scene)
  bounds,        // the floor area Miis can walk on
  obstacles,     // furniture and walls to walk around
  workSpots,     // desks (to sit and type; "Desk 1".."Desk 10", "Office A", "Office B")
                 // and break spots (coffee, water, servers, storage, the conference room...)
  rooms,         // the rooms (A, B, C, D, E, the open office, the hallway)
  doorPoint,     // just inside the front door
  outsidePath,   // the way down the hallway from the door
  outsidePoint,  // the end of the hallway: Miis fade in and out here
  doors,         // the room doors (each swings open when someone walks through)
  insidePoint,   // a few steps into the room
  cameraView,    // where the camera looks, and how far it can turn
  walls,         // the outer walls (hidden while the camera is behind them)
  background,
  setOwner(spotId, name), // shows who a desk / office belongs to
  update(t, info) // animations (the doors opening, the clock, the server lights, the fan)
}
```

To move a desk, change its line in `DESKS` in `office.js` (where it is, and which way the
person sitting there looks). To change what room C is, change the part marked "C: the
conference room".

To use a new office, write a file with the same `build()` and load it in `index.html`
instead. The details are at the top of `office.js`.

### The store (`js/nscc/store.js`)

All shared state goes through this one module: who is on today's board, each person's
location text and the time they left, the saved Miis, and who has which desk or office
(`getAssignments()`, `assignSpot(miiId, spotId)`). Every method is async (returns
a Promise) and the store tells the page about every change (`store.on(...)`).

Right now it saves everything **in this browser**: the board and the desks in localStorage
and the saved Miis (with their .glb files) in IndexedDB. Tabs open on the same computer stay in
sync. Each computer has its own board for now.

## Planned

- **A server**, so the TV and everyone's computers share one board. The plan: a small
  WebSocket server, and a store with the same methods as `store.js` that talks to it.
  The rest of the page doesn't need to change.

## Tests

```
npm test
```

Checks the store, going out and coming back in, the 6 PM rule (also when the page is
opened again after 6 PM or the next day), the top bar, who sits where (own desks, swaps,
nobody on someone else's desk), the office (every desk and spot can be reached on foot
from the front door, the door opens onto the hallway, the desk plan), and that the Miis
only make friendly small talk.

## Thanks

3D library: [three.js](https://threejs.org) (MIT, in `js/vendor`). Font: Nunito (SIL Open
Font License, in `fonts`). Mii models come from Mii Creator.
