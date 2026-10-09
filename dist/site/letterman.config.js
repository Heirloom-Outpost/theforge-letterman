// The app's own settings, plain defaults only. Content never carries these (Course Package Standard r2, §1: "no
// submission paths... Those belong to the app"), and the app names no course, server or channel: this deployment's
// Discord server, channels and public address live in letterman.deployment.json at the root of the repository, and
// tools/build.mjs adds them to the copy of this file that the page loads (board row M2-27). A person's own ids go in
// letterman.local.json (never saved in the repository): the build adds them too.
window.LETTERMAN_CONFIG = {
  prototype: false,                       // true mocks the Discord hand-off as "(prototype) would send"
  siteUrl: '',                            // the public address: from the deployment file
  discord: {
    server: 'Discord',
    handinChannel: '',
    channelUrl: '',
    handinMentions: [],                   // Discord mentions put at the top of the message the student pastes: '<@user id>' or '<@&role id>'
    discussChannel: '',                   // the channel for a class with no entry in discuss
    discuss: {}                           // per course folder name: { channel, url }
  }
};

// added by the build from letterman.deployment.json
(function (c, s) { if (s.siteUrl) c.siteUrl = s.siteUrl; Object.keys(s.discord).forEach(function (k) { c.discord[k] = s.discord[k]; }); })(window.LETTERMAN_CONFIG, {"siteUrl":"https://heirloom-outpost.github.io/theforge-letterman/","discord":{"server":"Hopper's Hangout","handinChannel":"#academy-hand-ins","channelUrl":"https://discord.com/channels/953682198190497794/1555713768250671177","handinMentions":["<@&1555713717306663064>"],"discuss":{"Animation_101":{"channel":"#animation-101","url":"https://discord.com/channels/953682198190497794/1555713771798929538","posts":{}}}}});
