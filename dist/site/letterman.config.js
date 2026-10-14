// The app's own settings, plain defaults only. Content never carries these (the Course Package Standard leaves
// submission paths to the app), and the app names no school, course, server or channel: this deployment's school name,
// Discord server, channels and public address live in letterman.deployment.json at the root of the repository, and tools/build.mjs
// adds them to the copy of this file that the page loads. A person's own ids go in letterman.local.json (never saved
// in the repository): the build adds them too.
window.LETTERMAN_CONFIG = {
  prototype: false,                       // true mocks the Discord hand-off as "(prototype) would send"
  siteUrl: '',                            // the public address: from the deployment file
  school: { name: '' },                   // the school's name: from the deployment file; none set means Letterman's own name alone
  discord: {
    server: 'Discord',
    handinChannel: '',
    channelUrl: '',
    handinMentions: [],                   // Discord mentions put at the top of the message the student pastes: '<@user id>' or '<@&role id>'
    discussChannel: '',                   // the channel for a class with no entry in discuss
    discuss: {}                           // per course folder name: { channel, url }
  },
  feedback: {
    fileLimitMB: 10                       // a tester's file in Send feedback; the service's feedback bucket holds the same limit
  }
};

// added by the build from letterman.deployment.json
(function (c, s) { if (s.siteUrl) c.siteUrl = s.siteUrl; c.school = s.school; Object.keys(s.discord).forEach(function (k) { c.discord[k] = s.discord[k]; }); })(window.LETTERMAN_CONFIG, {"siteUrl":"https://heirloom-outpost.github.io/theforge-letterman/","school":{"name":"Heirloom Estate Academy"},"discord":{"server":"Hopper's Hangout","handinChannel":"#academy-hand-ins","channelUrl":"https://discord.com/channels/953682198190497794/1555713768250671177","handinMentions":["<@&1555713717306663064>"],"discuss":{"Animation_101":{"channel":"#animation-101","url":"https://discord.com/channels/953682198190497794/1555713771798929538","posts":{}}}}});

// added by the build: Letterman's service, from service.settings.json
window.LETTERMAN_CONFIG.service = {"url":"https://smvouxvenarnjrphyadh.supabase.co","key":"sb_publishable_AJuNN5Rj7vtLn-jbN01qeQ_xbu2Rz8a"};

// added by the build: the service's public bucket of published modules, and the revision of each module this page was built with
window.LETTERMAN_CONFIG.published = {"bucket":"published","seed":{}};
