/*
 * js/nscc/chatter.js
 * Everything the Miis say, in one place. Add lines freely!
 * Keep them friendly, work-safe and light: small talk only.
 *
 *   {name}  the Mii saying it    {other}  the Mii it's talking to
 *   {place} the location typed for it (only in LEAVING lines)
 */
(function (root) {
  "use strict";

  const Chatter = {
    // little conversations between two Miis: [first Mii, second Mii, first Mii, ...]
    CONVERSATIONS: [
      ["Morning, {other}!", "Morning! Coffee's fresh, by the way.", "Best news all day!"],
      ["How's your week going, {other}?", "Pretty good! Busy, but good.", "Same here. Hang in there!"],
      ["Did you see the sunset yesterday?", "Yes! The sky was all pink.", "So pretty!"],
      ["Any plans for the weekend?", "Maybe a hike, if it's sunny.", "Nice! Take pictures!"],
      ["I like your shirt, {other}!", "Thanks! It's my comfy one.", "Comfy is the best."],
      ["Is it lunchtime yet?", "Almost! I'm thinking soup.", "Ooh, good idea."],
      ["Who brought the cookies?", "Not me, but I had two!", "Ha! Me too."],
      ["Have you tried the new tea?", "The peach one? Love it!", "Right? So good."],
      ["Nice job on that project, {other}!", "Thanks! Team effort.", "High five!"],
      ["I finally fixed my chair.", "No more squeak?", "Silent as a mouse!"],
      ["Did you watch the game last night?", "Only the end. What a finish!", "So exciting!"],
      ["The plants look happy today.", "Someone watered them!", "Good job, someone!"],
      ["Coffee or tea today, {other}?", "Hot chocolate, actually.", "Ooh, fancy!"],
      ["I learned a new keyboard shortcut!", "Show me later?", "Deal!"],
      ["It's so quiet today.", "Perfect for getting things done.", "Let's go!"],
    ],

    // now and then, while working at the desk
    WORK: ["*click clack*", "Almost done...", "Okay, next thing!", "Hmm, let me think.", "Saved!", "Nice, that worked!", "One more email...", "Checking my list."],

    // at the break spots (see the `kind` of each work spot in office.js)
    BREAK: {
      coffee: ["Coffee time!", "Mmm, fresh coffee.", "Just a little cup."],
      water: ["Staying hydrated!", "*glug glug*", "Ahh, refreshing."],
      stretch: ["Stretch break!", "Ahh, that's better.", "Time to move a bit."],
      window: ["Nice view today.", "Look at those clouds!", "What a day outside."],
      board: ["Hmm, good idea.", "Let me add that.", "Lots of plans!"],
      server: ["All the lights are green!", "Checking the backups.", "Servers look happy today."],
      storage: ["Where's that cable...", "Found a spare mouse!", "So many boxes!"],
      meeting: ["Quick look at the plan.", "Nice and quiet in here.", "Let me check the screen."],
    },

    // walking in through the door
    ARRIVE: ["Good morning!", "Hi, everyone!", "I'm here!", "Hello, hello!", "Back at it!"],
    // coming back in after being out
    RETURN: ["I'm back!", "Back again!", "Hi again, everyone!", "Missed me?"],
    // walking out, with a location typed in ({place})
    LEAVING: ["Off to {place}!", "Heading out: {place}.", "See you soon! ({place})", "Be back later!"],
    // 6:00 PM: everyone goes home
    END_OF_DAY: ["See you tomorrow!", "Good night, everyone!", "Bye! Great day today.", "Time to head home!"],
    // taken off the board by hand
    REMOVED: ["Bye for now!", "See you!", "Catch you later!"],
  };

  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  // Fills in {name}, {other} and {place}.
  function fill(text, vars) {
    vars = vars || {};
    return String(text)
      .replace(/\{name\}/g, vars.name || "")
      .replace(/\{other\}/g, vars.other || "")
      .replace(/\{place\}/g, vars.place || "");
  }
  // Every line in the list (for checks).
  function allLines() {
    const out = [];
    const walk = (v) => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
    walk(Chatter);
    return out;
  }

  const api = Object.assign({ pick, fill, allLines }, Chatter);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.NSCCChatter = api;
})(typeof self !== "undefined" ? self : this);
