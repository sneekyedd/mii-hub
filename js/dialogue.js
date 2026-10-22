/*
 * dialogue.js
 * Everything the Miis say and the little "scripts" they act out together.
 *
 * A script is a list of steps. Each step says who does something:
 *   { who: "A" | "B" | "both", say: "text", emote: "😀", expr: "laugh",
 *     arms: "wave", hop: true, dur: seconds }
 * In the text, {A} and {B} are replaced with the Miis' names.
 */
(function (root) {
  "use strict";

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---------- Friendship levels ----------
  const LEVELS = [
    { min: 0, name: "Strangers", emoji: "👋" },
    { min: 1, name: "Acquaintances", emoji: "🙂" },
    { min: 4, name: "Friends", emoji: "😊" },
    { min: 9, name: "Good Friends", emoji: "😄" },
    { min: 16, name: "Best Friends", emoji: "💖" },
  ];

  function levelFor(points) {
    let level = LEVELS[0];
    for (const l of LEVELS) if (points >= l.min) level = l;
    return level;
  }

  // ---------- Personality ----------
  // Each trait goes from 0 to 100 (50 = in the middle).
  const TRAITS = [
    { key: "energy", low: "Calm", high: "Energetic" },
    { key: "social", low: "Shy", high: "Outgoing" },
    { key: "chatty", low: "Quiet", high: "Chatty" },
    { key: "humor", low: "Serious", high: "Silly" },
    { key: "kindness", low: "Grumpy", high: "Sweet" },
  ];
  const DEFAULT_PERSONALITY = { energy: 50, social: 50, chatty: 50, humor: 50, kindness: 50, catchphrase: "" };

  function traits(m) {
    return Object.assign({}, DEFAULT_PERSONALITY, (m && m.personality) || {});
  }

  function randomPersonality() {
    const r = () => Math.round(20 + Math.random() * 60);
    return { energy: r(), social: r(), chatty: r(), humor: r(), kindness: r(), catchphrase: "" };
  }

  // A short Tomodachi-style description, like "Lively Joker" or "Quiet Sweetheart".
  function personalityLabel(p) {
    p = Object.assign({}, DEFAULT_PERSONALITY, p || {});
    let adj = "Easygoing";
    if (p.energy >= 60 && p.social >= 60) adj = "Lively";
    else if (p.energy >= 60) adj = "Adventurous";
    else if (p.social >= 60) adj = "Friendly";
    else if (p.energy <= 40 && p.social <= 40) adj = "Quiet";
    else if (p.energy <= 40) adj = "Laid-back";
    else if (p.social <= 40) adj = "Independent";
    let noun = "Buddy";
    if (p.humor >= 62 && p.humor >= p.kindness) noun = "Joker";
    else if (p.kindness >= 62) noun = "Sweetheart";
    else if (p.kindness <= 38) noun = "Grump";
    else if (p.humor <= 38) noun = "Thinker";
    return adj + " " + noun;
  }

  // Picks one option, where options with a bigger weight are picked more often.
  function weighted(options) {
    const total = options.reduce((t, o) => t + Math.max(0, o[1]), 0);
    let r = Math.random() * total;
    for (const [value, w] of options) { r -= Math.max(0, w); if (r <= 0) return value; }
    return options[options.length - 1][0];
  }

  // ---------- Things to say when two Miis first meet ----------
  function greeting(A, B, points) {
    const a = traits(A), b = traits(B);
    if (points === 0) {
      const sayA = a.social <= 35 ? pick(["Um... h-hi. I'm {A}.", "Oh! Um, hello... I'm {A}."])
        : a.energy >= 70 ? pick(["HEY THERE!! I'm {A}!!", "Hiii! I'm {A}! Nice to meet you!"])
        : pick(["Hi! I'm {A}!", "Hello there! I'm {A}.", "Oh, a new face! I'm {A}!"]);
      const sayB = b.social <= 35 ? pick(["...H-hi. I'm {B}.", "Oh... um, I'm {B}."])
        : b.kindness <= 35 ? pick(["Yeah, hi. I'm {B}.", "{B}. Nice to meet you, I guess."])
        : pick(["Nice to meet you! I'm {B}.", "Hi {A}! I'm {B}!", "Hey! Call me {B}."]);
      return [
        { who: "A", say: sayA, arms: a.social <= 35 ? undefined : "wave", dur: 2.2 },
        { who: "B", say: sayB, arms: b.social <= 35 ? undefined : "wave", dur: 2.2 },
      ];
    }
    if (points >= 16) {
      return [
        { who: "A", say: pick(["{B}!!! My best friend!", "BFF time!", "There you are, {B}!"]), arms: "cheer", hop: true, dur: 2 },
        { who: "B", say: pick(["{A}! I missed you!", "Yay, it's {A}!", "Best friends forever!"]), arms: "cheer", hop: true, emote: "💖", dur: 2 },
      ];
    }
    return [
      { who: "A", say: pick(["Hey {B}!", "Oh hi, {B}!", "What's up, {B}?", "Yo {B}!"]), arms: "wave", dur: 1.8 },
      { who: "B", say: pick(["Hi {A}!", "Oh hey!", "Not much, you?", "Hiya!"]), dur: 1.6 },
    ];
  }

  // ---------- The different things two Miis can do together ----------
  const interactions = {
    chat(A, B, scene) {
      const topics = {
        park: [
          ["Nice weather, huh?", "Yeah! Perfect day."],
          ["Want to feed the ducks later?", "Only if we bring bread!"],
          ["The flowers smell so good today.", "Achoo! ...I'm allergic."],
          ["Race you to the fountain!", "You're on!"],
        ],
        office: [
          ["Did you finish the report?", "...What report?!"],
          ["The coffee machine is broken again.", "Oh no! This is a disaster!"],
          ["Want to grab lunch?", "Pizza? Pizza."],
        ],
        space: [
          ["Do you think aliens are friendly?", "I hope so. I brought snacks."],
          ["How do you eat soup up here?", "Very... carefully."],
          ["Did you pack extra oxygen?", "I packed extra cookies."],
        ],
      };
      const generic = [
        ["What's your favorite food?", "Anything with cheese!"],
        ["I had the weirdest dream last night.", "Was I in it?"],
        ["Have you seen any good movies?", "I only watch cartoons."],
        ["Do you like video games?", "I'm the champion of my couch!"],
      ];
      const [q, a] = pick((topics[scene.id] || []).concat(generic));
      return [
        { who: "A", say: q, dur: 2.6 },
        { who: "B", say: a, dur: 2.6 },
        { who: "A", say: pick(["Haha, true!", "Same here!", "Ha! Classic {B}.", "Cool!"]), expr: "laugh", dur: 1.6 },
      ];
    },

    compliment(A, B, scene, points) {
      // Only say things that are really true about B. These come from the
      // Mii's file (its height, its hair color, what it's wearing) or from
      // its personality. If we're not sure about something, we don't say it.
      const f = B.facts || {};
      const b = traits(B);
      const options = [];
      const garment = f.garment || "top";
      if (f.top) options.push("I love your " + f.top + " " + garment + "!", "That " + f.top + " " + garment + " really suits you!");
      else if (f.garment) options.push("Cool " + f.garment + ", {B}!", "Where did you get that " + f.garment + "?");
      if (f.hair) options.push("Your " + f.hair + " hair looks great today!");
      if (f.tall) options.push("You're so tall, {B}!");
      if (f.short) options.push("You're so cute and small, {B}!");
      if (points >= 4) {
        options.push("You're so fun to hang out with, {B}!");
        if (b.humor >= 60) options.push("You always make me laugh, {B}!");
        if (b.kindness >= 60) options.push("You're the nicest, {B}!");
        if (b.energy >= 65) options.push("How do you have so much energy?!");
        if (b.energy <= 35) options.push("You're so calm. It's nice being around you.");
        if (b.social <= 35) options.push("I'm glad you talk to me, {B}.");
      }
      if (!options.length) options.push("I like your style, {B}!", "You seem really nice, {B}!");
      const reply = b.kindness <= 35 ? pick(["Hmph. ...Thanks.", "I know.", "...You really think so?"])
        : b.social <= 35 ? pick(["*blushes* Th-thanks...", "Oh! Um... thank you!"])
        : pick(["Aww, thanks {A}!", "You're too kind!", "*blushes*"]);
      return [
        { who: "A", say: pick(options), dur: 2.4 },
        { who: "B", say: reply, expr: "love", emote: "😊", dur: 2.2 },
      ];
    },

    joke(A, B) {
      const jokes = [
        ["Why did the Mii cross the road?", "To get to the other plaza!"],
        ["What do you call a sleeping dinosaur?", "A dino-snore!"],
        ["Why are ghosts bad liars?", "You can see right through them!"],
        ["What do you call cheese that isn't yours?", "Nacho cheese!"],
        ["Why did the cookie go to the doctor?", "It felt crummy!"],
      ];
      const [setup, punch] = pick(jokes);
      return [
        { who: "A", say: "Want to hear a joke?", dur: 1.8 },
        { who: "B", say: "Sure!", dur: 1.2 },
        { who: "A", say: setup, dur: 2.6 },
        { who: "B", say: "Hmm... I don't know?", expr: "surprised", dur: 1.8 },
        { who: "A", say: punch, expr: "laugh", dur: 2.4 },
        { who: "B", say: pick(["HAHAHA!", "LOL!", "Oh no... that's so bad! Haha!"]), expr: "laugh", emote: "😂", hop: true, dur: 2 },
      ];
    },

    dance() {
      return [
        { who: "A", say: "Dance party!", arms: "cheer", dur: 1.4 },
        { who: "both", emote: "🎵", arms: "out", hop: true, dance: true, dur: 3.6 },
        { who: "B", say: pick(["Nice moves!", "Woo!", "That was fun!"]), expr: "laugh", dur: 1.6 },
      ];
    },

    highFive() {
      return [
        { who: "A", say: pick(["Up top!", "High five!", "Gimme five!"]), arms: "up", dur: 1.3 },
        { who: "both", arms: "up", emote: "✋", hop: true, sound: "clap", dur: 1.2 },
        { who: "B", say: pick(["Yeah!", "Nice!", "Boom!"]), expr: "laugh", dur: 1.3 },
      ];
    },

    rockPaperScissors() {
      const hands = ["✊", "✋", "✌️"];
      const names = ["Rock!", "Paper!", "Scissors!"];
      const a = Math.floor(Math.random() * 3);
      const b = Math.floor(Math.random() * 3);
      const steps = [
        { who: "A", say: "Rock, paper, scissors?", dur: 1.8 },
        { who: "B", say: "You're on!", dur: 1.2 },
        { who: "both", say: "Rock... paper... scissors...", arms: "up", dur: 1.8 },
        { who: "A", say: names[a], emote: hands[a], dur: 0.01 },
        { who: "B", say: names[b], emote: hands[b], dur: 1.8 },
      ];
      if (a === b) {
        steps.push({ who: "both", say: "A tie!", expr: "surprised", dur: 1.8 });
      } else {
        const aWins = (a - b + 3) % 3 === 1;
        const winner = aWins ? "A" : "B";
        const loser = aWins ? "B" : "A";
        steps.push({ who: winner, say: pick(["I win!", "Yes!!", "Victory!"]), arms: "cheer", hop: true, expr: "laugh", dur: 1.8 });
        steps.push({ who: loser, say: pick(["Aww, rematch!", "No fair!", "Next time!"]), expr: "sad", dur: 1.8 });
      }
      return steps;
    },

    disagree(A, B) {
      const topics = [
        ["Cats are the best pets.", "No way, dogs are!"],
        ["Pineapple belongs on pizza.", "Absolutely not!"],
        ["Summer is the best season.", "Winter is better!"],
        ["Socks with sandals are stylish.", "That's a crime!"],
        ["The last cookie is mine.", "I saw it first!"],
      ];
      const [x, y] = pick(topics);
      const start = [
        { who: "A", say: x, dur: 2.2 },
        { who: "B", say: y, expr: "angry", emote: "💢", dur: 2.2 },
        { who: "A", say: "Hmph!", expr: "angry", dur: 1.4 },
      ];
      // grumpy Miis don't always make up straight away: then it's a real fight
      const grump = (200 - traits(A).kindness - traits(B).kindness) / 200;
      if (Math.random() < 0.08 + grump * 0.3) {
        return { fight: true, steps: start.concat([
          { who: "B", say: pick(["I'm not talking to you!", "Fine! Be that way!", "You're impossible!"]), expr: "angry", emote: "💢", dur: 2.0 },
          { who: "A", say: pick(["Good! Hmph!", "See if I care!", "*turns away*"]), expr: "angry", dur: 1.8 },
        ]) };
      }
      return start.concat([
        { who: "B", say: "...Want to be friends anyway?", dur: 2.2 },
        { who: "A", say: "Of course!", expr: "laugh", emote: "🤝", dur: 1.8 },
      ]);
    },

    // still upset after a fight: a frosty little exchange
    cold() {
      return [
        { who: "A", say: pick(["...", "Oh. It's you.", "*looks away*"]), expr: "angry", dur: 1.8 },
        { who: "B", say: pick(["Hmph.", "Whatever.", "..."]), expr: "angry", emote: "💢", dur: 1.6 },
      ];
    },

    // you helped them make up after a fight
    makeUp() {
      return [
        { who: "A", say: pick(["Um... {B}? Can we talk?", "{B}... I'm sorry about before."]), expr: "sad", dur: 2.2 },
        { who: "B", say: pick(["I'm sorry too...", "I was being silly. Sorry, {A}."]), expr: "sad", dur: 2.2 },
        { who: "A", say: pick(["Friends again?", "Let's never fight again!"]), dur: 1.8 },
        { who: "both", say: "Friends!", arms: "cheer", hop: true, emote: "🤝", dur: 2.0 },
      ];
    },

    // telling a crush how they feel (ctx.confess.success decides the answer)
    confess(A, B, scene, points, ctx) {
      const yes = ctx && ctx.confess && ctx.confess.success;
      const steps = [
        { who: "A", say: pick(["{B}... can I tell you something?", "Um, {B}? I have to say something..."]), expr: "sad", dur: 2.2 },
        { who: "B", say: "Sure, what is it?", dur: 1.6 },
        { who: "A", say: pick(["I... I really like you! 💗", "Will you go out with me? 💌", "My heart goes doki doki when I see you!"]), emote: "💗", dur: 2.6 },
        { who: "B", say: "...!", expr: "surprised", emote: "❗", dur: 1.5 },
      ];
      if (yes) return steps.concat([
        { who: "B", say: pick(["I like you too! 💕", "Yes! I've been waiting for you to ask!", "Really?! Me too!"]), emote: "💕", arms: "cheer", hop: true, dur: 2.4 },
        { who: "both", say: "💑", emote: "💖", dance: true, hop: true, dur: 2.4 },
      ]);
      return steps.concat([
        { who: "B", say: pick(["Oh... I'm sorry. Can we just be friends?", "You're really nice, but... I just like you as a friend."]), expr: "sad", dur: 2.6 },
        { who: "A", say: pick(["Oh... okay. I understand.", "*sniff* ...Friends is good too."]), expr: "sad", emote: "💔", dur: 2.4 },
      ]);
    },

    // a couple on a date
    date() {
      const what = pick([
        ["Want to go for a walk together?", "I'd love that! 💕"],
        ["I made you a sandwich!", "You're the best! 💕"],
        ["Look at the sky... it's so pretty.", "Not as pretty as you. 💕"],
        ["Let's take a selfie!", "Say cheese! 📸"],
      ]);
      return [
        { who: "A", say: pick(["Hi, sweetie!", "There you are, {B}! 💕"]), emote: "💕", dur: 1.8 },
        { who: "A", say: what[0], dur: 2.2 },
        { who: "B", say: what[1], emote: "💖", dur: 2.2 },
        { who: "both", emote: "💞", arms: "out", dance: true, dur: 2.2 },
      ];
    },

    // rivals: always competing
    rivalry() {
      const contest = pick([
        ["Bet I can jump higher than you!", "jump"],
        ["Staring contest. Now.", "stare"],
        ["I'm faster than you!", "jump"],
      ]);
      const aWins = Math.random() < 0.5;
      return [
        { who: "A", say: "Oh, it's you, {B}.", expr: "angry", emote: "⚡", dur: 1.8 },
        { who: "B", say: "{A}. My rival.", expr: "angry", dur: 1.6 },
        { who: "A", say: contest[0], dur: 2.0 },
        { who: "both", say: contest[1] === "stare" ? "..." : "Hup!", hop: contest[1] !== "stare", moonJump: contest[1] === "jump", dur: 2.2 },
        { who: aWins ? "A" : "B", say: pick(["Ha! I win!", "Victory is mine!", "Too easy!"]), arms: "cheer", hop: true, dur: 1.8 },
        { who: aWins ? "B" : "A", say: pick(["Next time, rival!", "Grr! Rematch!", "Hmph. Lucky."]), expr: "angry", dur: 1.8 },
      ];
    },

    // town level 2: a picnic
    picnic() {
      const food = pick(["sandwiches", "rice balls", "strawberries", "cookies", "lemonade"]);
      return [
        { who: "A", say: "I packed a picnic! Want some " + food + "?", arms: "out", dur: 2.4 },
        { who: "B", say: pick(["Yes please!", "You're the best!", "Yum!"]), dur: 1.6 },
        { who: "both", arms: "eat", emote: "🧺", dur: 3.0 },
        { who: "B", say: pick(["Delicious!", "Best picnic ever!", "*munch munch*"]), expr: "laugh", dur: 1.8 },
      ];
    },

    // town level 4: karaoke (using songs the Miis learned)
    karaoke(A, B, scene, points, ctx) {
      const songs = (ctx && ctx.songs && ctx.songs.length) ? ctx.songs : [{ title: "Happy Birthday", lines: ["♪ Happy birthday to youuu ♪", "♪ Happy birthday dear somebody ♪", "♪ Happy birthday to youuu! ♪"] }];
      const song = pick(songs);
      return [
        { who: "A", say: "Karaoke time! Let's sing \"" + song.title + "\"!", arms: "cheer", emote: "🎤", dur: 2.4 },
        { who: "A", say: song.lines[0], arms: "out", emote: "🎵", dur: 2.4 },
        { who: "B", say: song.lines[1], arms: "out", emote: "🎵", dur: 2.4 },
        { who: "both", say: song.lines[2], dance: true, emote: "🎶", dur: 2.6 },
        { who: "B", say: pick(["We're stars!", "Encore!", "That was amazing!"]), expr: "laugh", dur: 1.8 },
      ];
    },

    // town level 7: telling stories
    story() {
      const tale = pick([
        ["Once, I saw a duck wearing a hat.", "No way!", "It was a very fancy duck."],
        ["Did you know there's a cat that runs the mail room?", "Really?!", "It only delivers fish."],
        ["I once ate 12 pancakes in a row.", "Wow!", "...I didn't eat lunch."],
        ["Last night I dreamed I was the moon.", "Was it nice?", "It was very round."],
      ]);
      return [
        { who: "A", say: "Want to hear a story?", dur: 1.6 },
        { who: "B", say: "Ooh, yes!", emote: "📚", dur: 1.4 },
        { who: "A", say: tale[0], arms: "out", dur: 2.6 },
        { who: "B", say: tale[1], expr: "surprised", dur: 1.6 },
        { who: "A", say: tale[2], dur: 2.2 },
        { who: "B", say: pick(["Hahaha!", "Tell me another!", "What a story!"]), expr: "laugh", dur: 1.6 },
      ];
    },
    // a hint for you: A talks about its favorite furniture that it doesn't have yet
    // (ctx.favWant = { name, icon }, from progress.js)
    hint(A, B, scene, points, ctx) {
      const it = ctx.favWant;
      const n = it.name.toLowerCase();
      const a = /^[aeiou]/.test(n) ? "an " : "a ";
      return [
        { who: "A", say: pick(["I wish I had " + a + n + "...", "*sigh* If only I had " + a + n + "...", "You know what I really want? " + it.icon + " " + it.name + "!"]), emote: "💭", dur: 2.6 },
        { who: "B", say: pick([it.name + "? That would suit you!", "Ooh, that sounds nice!", "Maybe someone will get you one!"]), dur: 2.2 },
        { who: "A", say: pick(["One day...", "A Mii can dream!", "*daydreams*"]), expr: "laugh", dur: 1.8 },
      ];
    },

    // A asks B to join its band (ctx.bandAsk = { song, accept }, from progress.js)
    bandInvite(A, B, scene, points, ctx) {
      const ask = ctx.bandAsk;
      const steps = [
        { who: "A", say: pick(["{B}, want to join my band? 🎸", "I'm starting a band! Want to be in it, {B}?", "We need one more cool Mii for my band... you in?"]), arms: "out", dur: 2.4 },
        { who: "A", say: "We're going to play \"" + ask.song + "\"!", emote: "🎶", dur: 2.2 },
      ];
      if (ask.accept) return steps.concat([
        { who: "B", say: pick(["Count me in! 🤘", "YES! I've always wanted to be in a band!", "Let's rock!"]), arms: "cheer", hop: true, emote: "🤘", dur: 2.2 },
        { who: "both", say: "🎸🥁🎤", dance: true, emote: "🎵", dur: 2.0 },
      ]);
      return steps.concat([
        { who: "B", say: pick(["Sorry, I'm not really a band person...", "Hmm... maybe another time.", "I get stage fright... sorry!"]), expr: "sad", dur: 2.4 },
        { who: "A", say: pick(["Aww, okay!", "No worries!", "Your loss! Hehe."]), dur: 1.6 },
      ]);
    },

    sleepy() {
      return [
        { who: "A", say: "*yawwwn*", sleep: true, emote: "💤", dur: 2 },
        { who: "B", say: "Wake up, {A}!", arms: "wave", expr: "surprised", dur: 1.8 },
        { who: "A", say: "I'm awake! I'm awake!", expr: "surprised", hop: true, dur: 1.8 },
      ];
    },

    spaceBounce() {
      return [
        { who: "A", say: "Moon jump contest!", arms: "cheer", dur: 1.6 },
        { who: "A", moonJump: true, emote: "⬆️", dur: 2.4 },
        { who: "B", moonJump: true, emote: "⬆️", dur: 2.4 },
        { who: "both", say: "Wheee!", expr: "laugh", dur: 1.6 },
      ];
    },
  };

  // Greetings when two Miis talk from far away (see buildInteraction).
  function remoteGreeting(A, B, points, mode) {
    if (mode === "phone") {
      return [
        { who: "A", say: pick(["*dials*", "*ring ring*"]), dur: 1.4 },
        { who: "B", say: points === 0 ? "Hello? Who is this?" : pick(["Hello?", "Oh hey, {A}!", "{A}! What's up?"]), dur: 1.8 },
        { who: "A", say: points === 0 ? "Hi! It's {A}! A friend gave me your number!" : pick(["Hey {B}! It's me!", "Hiya! Got a minute?"]), dur: 2.2 },
      ];
    }
    return [
      { who: "A", say: points === 0 ? "Hey, you over there! I'm {A}!" : pick(["Hey {B}!", "Yoo-hoo, {B}!", "Over here, {B}!"]), arms: "wave", dur: 1.8 },
      { who: "B", say: points === 0 ? "Oh! Hi! I'm {B}!" : pick(["Oh, hi {A}!", "What?", "Hey!"]), arms: "wave", dur: 1.6 },
    ];
  }

  // Chooses what two Miis will do. Their personalities change the odds:
  // silly Miis tell more jokes, energetic ones dance, grumpy ones argue...
  // opts.remote = "shout" or "phone" when they're far apart (then only talking things).
  // opts.ctx (from progress.js) = what's going on between them: a fight, a couple,
  // rivals, a confession to make, which fun things the town has unlocked...
  function buildInteraction(A, B, scene, points, opts) {
    const a = traits(A), b = traits(B);
    const avg = (k) => (a[k] + b[k]) / 2;
    const remote = opts && opts.remote;
    const ctx = (opts && opts.ctx) || {};
    const un = ctx.unlocked || {};
    let type;
    if (!remote && ctx.confess) type = "confess";
    else if (ctx.makeUp) type = "makeUp";
    else if (ctx.fight) type = "cold";
    else if (ctx.bandAsk) type = "bandInvite";
    else if (remote) {
      type = points === 0 ? "chat" : weighted([
        ["chat", 3],
        ["hint", ctx.favWant ? 0.5 : 0],
        ["joke", 0.5 + avg("humor") / 30],
        ["compliment", points >= 4 ? 0.3 + a.kindness / 35 : 0],
        ["disagree", points >= 1 ? 0.08 + (100 - avg("kindness")) / 110 : 0],
      ]);
    } else {
      type = points === 0 ? "chat" : weighted([
        ["chat", 3],
        ["hint", ctx.favWant ? 0.6 : 0],
        ["joke", 0.5 + avg("humor") / 30],
        ["compliment", 0.3 + a.kindness / 35],
        ["highFive", 0.4 + avg("energy") / 45],
        ["rockPaperScissors", 1],
        ["dance", (points >= 4 ? 0.6 : 0.2) + avg("energy") / 40 + avg("humor") / 80],
        ["sleepy", points >= 4 ? 0.4 + (100 - a.energy) / 70 : 0],
        ["disagree", points >= 1 ? 0.08 + (100 - avg("kindness")) / 90 : 0],
        ["spaceBounce", scene.id === "space" ? 1.5 + avg("energy") / 50 : 0],
        ["date", ctx.couple ? 3 : 0],
        ["rivalry", ctx.rival ? 2.5 : 0],
        ["picnic", un.picnic && points >= 1 ? 0.8 : 0],
        ["karaoke", un.karaoke && points >= 2 ? 0.6 + avg("humor") / 100 + (ctx.songs && ctx.songs.length ? 0.8 : 0) : 0],
        ["story", un.stories && points >= 1 ? 0.7 + avg("chatty") / 80 : 0],
      ]);
    }
    const hello = remote ? remoteGreeting(A, B, points, remote) : type === "cold" || type === "makeUp" || type === "confess" || type === "bandInvite" ? [] : greeting(A, B, points);
    let body = interactions[type](A, B, scene, points, ctx);
    let fight = false;
    if (body && body.steps) { fight = !!body.fight; body = body.steps; }
    let steps = hello.concat(body);
    if (remote) {
      // far apart: no looking at each other's clothes, no high fives
      steps = steps.map((s) => Object.assign({}, s, { arms: remote === "phone" ? undefined : s.arms === "wave" ? "wave" : undefined, hop: remote === "phone" ? false : s.hop }));
      if (type === "compliment") steps[steps.length - 2].say = pick(["You're so fun to talk to, {B}!", "I'm glad we're friends, {B}!"]);
      steps.push({ who: "A", say: remote === "phone" ? pick(["Okay, talk later! Bye!", "Gotta go! Bye!"]) : pick(["See you later!", "Bye {B}!"]), dur: 1.8 });
      if (remote === "phone") steps.push({ who: "B", say: pick(["Bye!", "Later!", "*click*"]), dur: 1.4 });
    }
    // sometimes finish with a catchphrase
    const cp = a.catchphrase && a.catchphrase.trim();
    if (cp && Math.random() < 0.35 && !fight && type !== "cold") steps.push({ who: "A", say: cp, dur: 2.0 });
    const success = type === "confess" ? !!(ctx.confess && ctx.confess.success) : type === "bandInvite" ? !!ctx.bandAsk.accept : undefined;
    // a feed line with more detail than FEED_TEXT (what it hinted at, whether B joined the band)
    let feed;
    if (type === "hint") feed = "{A} told {B} they'd love " + (/^[aeiou]/i.test(ctx.favWant.name) ? "an " : "a ") + ctx.favWant.name.toLowerCase() + ". " + ctx.favWant.icon;
    if (type === "bandInvite") feed = success ? "{B} joined {A}'s band! 🎸" : "{B} said no to joining {A}'s band.";
    return { type, steps, fight, success, feed };
  }

  // What happens to the friendship after an interaction (some are more fun than others!)
  const FRIENDSHIP_GAIN = {
    chat: 1, compliment: 2, joke: 2, dance: 2, highFive: 1,
    rockPaperScissors: 1, disagree: 1, sleepy: 1, spaceBounce: 2,
    cold: 0, makeUp: 3, confess: 3, date: 3, rivalry: 1, picnic: 2, karaoke: 2, story: 2,
    hint: 1, bandInvite: 2,
  };

  // Short descriptions for the activity feed.
  const FEED_TEXT = {
    chat: "{A} and {B} had a chat.",
    compliment: "{A} complimented {B}.",
    joke: "{A} told {B} a joke.",
    dance: "{A} and {B} had a dance party!",
    highFive: "{A} and {B} high-fived.",
    rockPaperScissors: "{A} and {B} played rock-paper-scissors.",
    disagree: "{A} and {B} argued... then made up.",
    sleepy: "{B} woke up a sleepy {A}.",
    spaceBounce: "{A} and {B} had a moon jump contest!",
    cold: "{A} and {B} are still not talking.",
    makeUp: "{A} and {B} made up. 🩹",
    confess: "{A} told {B} how they feel... 💌",
    date: "{A} and {B} went on a date. 💕",
    rivalry: "Rivals {A} and {B} had a contest! ⚡",
    picnic: "{A} and {B} had a picnic. 🧺",
    karaoke: "{A} and {B} sang karaoke! 🎤",
    story: "{A} told {B} a story. 📚",
    hint: "{A} told {B} about something they'd love to have. 💭",
    bandInvite: "{A} asked {B} to join their band. 🎸",
  };

  // Things a Mii says to nobody in particular.
  const SOLO_LINES = [
    "Hmm hmm hmm~", "I'm hungry.", "What should I do today?", "♪ La la la ♪",
    "I feel great!", "Did I leave the oven on?", "*whistles*", "Hmm...",
  ];

  const TRAIT_LINES = {
    energyHigh: ["Let's go, go, go!", "I can't sit still!", "Race you! ...Anyone?", "Woohoo!"],
    energyLow: ["Ahh, so relaxing.", "Let's take it slow today.", "*yawn*", "Maybe a little nap..."],
    socialHigh: ["Who wants to hang out?", "I love meeting new people!", "Party at my place!"],
    socialLow: ["...", "*looks around nervously*", "I'll just stand over here.", "Um..."],
    humorHigh: ["*does a silly dance*", "Boop!", "I'm a little teapot~", "Knock knock! ...Anyone?"],
    humorLow: ["Hmm, let me think...", "Interesting.", "I should make a plan."],
    kindHigh: ["I hope everyone's having a nice day!", "You're all great!", "Group hug, anyone?"],
    kindLow: ["Hmph.", "Everyone's so loud today.", "Don't bother me.", "Whatever."],
  };

  function soloLine(mii, scene, bestFriendName) {
    const t = traits(mii);
    if (t.catchphrase && t.catchphrase.trim() && Math.random() < 0.2) return t.catchphrase.trim();
    const pool = scene.lines.concat(SOLO_LINES);
    // strong personality traits add their own lines
    const add = (cond, lines) => { if (cond) for (let i = 0; i < 2; i++) pool.push(...lines); };
    add(t.energy >= 65, TRAIT_LINES.energyHigh); add(t.energy <= 35, TRAIT_LINES.energyLow);
    add(t.social >= 65, TRAIT_LINES.socialHigh); add(t.social <= 35, TRAIT_LINES.socialLow);
    add(t.humor >= 65, TRAIT_LINES.humorHigh); add(t.humor <= 35, TRAIT_LINES.humorLow);
    add(t.kindness >= 65, TRAIT_LINES.kindHigh); add(t.kindness <= 35, TRAIT_LINES.kindLow);
    if (bestFriendName) {
      pool.push("I wonder what " + bestFriendName + " is doing.", bestFriendName + " is the best!");
    }
    return pick(pool);
  }

  const CLICK_LINES = [
    "Hi there!", "Oh! You startled me!", "Hehe, that tickles!", "Hello!", "Need something?",
    "*waves*", "Hey, that's me!",
  ];
  const PICKUP_LINES = ["Whoa!", "Put me down!", "Wheee!", "I'm flying!", "Eek!"];
  const DROP_LINES = ["Phew!", "Oof!", "That was fun!", "Again!", "Where am I?"];

  root.Dialogue = {
    TRAITS, DEFAULT_PERSONALITY, traits, randomPersonality, personalityLabel,
    LEVELS, levelFor, buildInteraction, FRIENDSHIP_GAIN, FEED_TEXT,
    soloLine, CLICK_LINES, PICKUP_LINES, DROP_LINES, pick, weighted,
  };
})(typeof self !== "undefined" ? self : this);
