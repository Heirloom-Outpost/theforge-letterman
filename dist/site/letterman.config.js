// The app's own settings: where hand-ins go and where the site lives. Content never carries these
// (Course Package Standard r2, §1: "no submission paths... Those belong to the app").
// Discord channels made by the Academy on the Director's confirmation, 2026-10-02: one hand-in channel for
// every class, where each student starts a private thread; one discussion channel per class.
window.LETTERMAN_CONFIG = {
  prototype: false,                       // true mocks the Discord hand-off as "(prototype) would send"
  siteUrl: 'https://heirloom-outpost.github.io/theforge-letterman/',   // the public address, on the Director's word (estate path naming)
  discord: {
    server: "Hopper's Hangout",
    handinChannel: '#academy-hand-ins',
    channelUrl: 'https://discord.com/channels/953682198190497794/1555713768250671177',
    // Who is told of a new hand-in: Discord mentions put at the top of the message the student pastes, such as
    // '<@user id>' or '<@&role id>'. Mentioning someone in a private thread adds them to it and notifies them.
    // A person's own ids go in letterman.local.json at the root of this repository (never saved in the
    // repository): the build adds them to the page it writes. Only <@id> and <@&id> are kept.
    handinMentions: ['<@&1555713717306663064>'],   // the server's Teacher role (the Director's pass, 2026-10-04): whoever teaches is told
    discussChannel: '#animation-101',     // the class's own channel; per course below
    discuss: {
      Animation_101: { channel: '#animation-101', url: 'https://discord.com/channels/953682198190497794/1555713771798929538' }
    }
  }
};
