// Letterman's times: the one place a time or a date is put into words (M1-26).
// The Director, 2026-10-02: "this shouldn't be hardcoded but a custom config, but times displayed in the professor's time
// zone". The row: "the course sets its time zone, and every time shows in the teacher's." So: the course says its time
// zone (course.json meta.time_zone, an IANA name such as "America/Los_Angeles"); a class's own time zone (the classes
// table, set by its teacher) wins for a student in that class. Every time then shows in that zone, named, with the
// student's own time beside it when it is different: "Monday 12 October, 18:00 Los Angeles time. That is 10:00 on
// Tuesday where you are." A module opens at the start of its date in that zone, for everyone at once.
// With no zone (a course that has not said one, and no class), every time is on the student's own clock and a module
// opens at the start of its date there, as before.
// No line of this file names a course or a place: the zone comes from the course or the class.
(function () {
  'use strict';
  const LOCALE = 'en-GB';   // "Monday 12 October", "18:00": the page's language is the course's; English today (board row C10)
  function valid(tz) { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; } }
  function deviceZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } }
  // how far the zone's clock is from UTC at an instant, in milliseconds
  function offset(t, tz) {
    const o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).forEach(p => { o[p.type] = p.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(t / 1000) * 1000;
  }
  // The instant a date (YYYY-MM-DD) begins in a zone: 00:00 there. With no zone, on this device's clock.
  function midnight(date, tz) {
    const [y, m, d] = String(date).split('-').map(Number);
    if (!tz) return new Date(y, m - 1, d).getTime();
    const guess = Date.UTC(y, m - 1, d);
    let t = guess - offset(guess, tz);
    t = guess - offset(t, tz);   // a second pass settles a day the clocks change
    return t;
  }
  const label = tz => /^(Etc\/)?(UTC|GMT|Zulu|Universal)$/.test(tz) ? 'UTC' : tz.split('/').pop().replace(/_/g, ' ') + ' time';
  // "Monday 12 October", built from its parts so every browser says it the same way
  const day = (t, tz) => {
    const o = {};
    new Intl.DateTimeFormat(LOCALE, Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, tz ? { timeZone: tz } : {})).formatToParts(new Date(t)).forEach(p => { o[p.type] = p.value; });
    return `${o.weekday} ${o.day} ${o.month}`;
  };
  const clock = (t, tz) => new Intl.DateTimeFormat(LOCALE, Object.assign({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, tz ? { timeZone: tz } : {})).format(new Date(t));

  // zone: the teacher's time zone (the class's, else the course's), or null
  function create(zone, here) {
    const z = valid(zone) ? zone : null;
    const mine = here || deviceZone();
    // the student's own time, when it reads differently from the teacher's
    function beside(t) {
      if (!z || !mine || mine === z) return null;
      const dz = day(t, z), dm = day(t, mine), cz = clock(t, z), cm = clock(t, mine);
      if (dz === dm && cz === cm) return null;
      return dz === dm ? `That is ${cm} where you are.` : `That is ${cm} on ${dm.split(' ')[0]} where you are.`;
    }
    return {
      zone: z,
      // a moment: "Friday 9 October, 18:03 Los Angeles time" and, apart, "That is 10:03 on Saturday where you are."
      say(iso) {
        const t = typeof iso === 'number' ? iso : Date.parse(iso);
        if (isNaN(t)) return { main: '', local: null };
        if (!z) return { main: `${day(t)}, ${clock(t)}`, local: null };
        return { main: `${day(t, z)}, ${clock(t, z)} ${label(z)}`, local: beside(t) };
      },
      // when a dated module opens: the start of its date in the teacher's zone
      opensAt: date => midnight(date, z),
      opens(date) {
        if (!z) return { main: day(midnight(date, null)), local: null };   // as before: the date, on the student's own clock
        const t = midnight(date, z);
        return { main: `${day(t, z)}, ${clock(t, z)} ${label(z)}`, local: beside(t) };
      }
    };
  }
  window.LMWhen = { create, valid, midnight, label, deviceZone };
})();
