// Letterman's times: the one place a time or a date is put into words.
// Times show in the teacher's time zone, which is configuration, never code: the course says its time
// zone (course.json meta.time_zone, an IANA name such as "America/Los_Angeles"); a class's own time zone (the classes
// table, set by its teacher) wins for a student in that class. Every time then shows in that zone, named, with the
// student's own time beside it when it is different: "Monday 12 October, 18:00 Los Angeles time. That is 10:00 on
// Tuesday where you are." A module opens at the start of its date in that zone, for everyone at once.
// With no zone (a course that has not said one, and no class), every time is on the student's own clock and a module
// opens at the start of its date there.
// No line of this file names a course or a place: the zone comes from the course or the class.
(function () {
  'use strict';
  // Every date and time follows the device's own locale, so one screen reads in one style: "Monday 12 October" and "18:00" on a
  // British device, "Monday, October 12" and "6:00 PM" on an American one. (undefined is the device's locale.)
  const LOCALE = undefined;
  function valid(tz) { if (typeof tz !== 'string' || !tz) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; } }
  function deviceZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { return null; } }
  // how far the zone's clock is from UTC at an instant, in milliseconds
  function offset(t, tz) {
    const o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).forEach(p => { o[p.type] = p.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(t / 1000) * 1000;
  }
  // The instant a wall-clock time ("18:00", on a date YYYY-MM-DD) happens in a zone. With no zone, on this device's clock.
  function wall(date, time, tz) {
    const [y, m, d] = String(date).split('-').map(Number), [hh, mm] = String(time || '00:00').split(':').map(Number);
    if (!tz) return new Date(y, m - 1, d, hh || 0, mm || 0).getTime();
    const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
    let t = guess - offset(guess, tz);
    t = guess - offset(t, tz);   // a second pass settles a day the clocks change
    return t;
  }
  // The instant a date (YYYY-MM-DD) begins in a zone: 00:00 there. With no zone, on this device's clock.
  const midnight = (date, tz) => wall(date, '00:00', tz);
  // a calendar date moved by whole days (dates are plain strings, so no clock change can move them)
  function addDays(date, n) { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
  // the day of the week of a calendar date: 0 is Sunday
  const weekday = date => { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  // the calendar date (YYYY-MM-DD) an instant falls on in a zone
  function civil(t, tz) {
    const o = {};
    new Intl.DateTimeFormat('en-US', Object.assign({ year: 'numeric', month: '2-digit', day: '2-digit' }, tz ? { timeZone: tz } : {})).formatToParts(new Date(t)).forEach(p => { o[p.type] = p.value; });
    return `${o.year}-${o.month}-${o.day}`;
  }
  const label = tz => /^(Etc\/)?(UTC|GMT|Zulu|Universal)$/.test(tz) ? 'UTC' : tz.split('/').pop().replace(/_/g, ' ') + ' time';
  const inZone = (opts, tz) => Object.assign({}, opts, tz ? { timeZone: tz } : {});
  // "Monday 12 October" (and its weekday alone, and the time of day), in the device's own style
  const day = (t, tz) => new Intl.DateTimeFormat(LOCALE, inZone({ weekday: 'long', day: 'numeric', month: 'long' }, tz)).format(new Date(t));
  const weekdayName = (t, tz) => new Intl.DateTimeFormat(LOCALE, inZone({ weekday: 'long' }, tz)).format(new Date(t));
  // a 24-hour device pads the hour ("08:00", "00:00"); a 12-hour one does not ("8:00 AM")
  const padHour = () => { const c = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric' }).resolvedOptions().hourCycle; return c === 'h23' || c === 'h24'; };
  const clock = (t, tz) => new Intl.DateTimeFormat(LOCALE, inZone({ hour: padHour() ? '2-digit' : 'numeric', minute: '2-digit' }, tz)).format(new Date(t));
  // "Mon 12 Oct", and a run of days: "12 to 18 Oct", "28 Oct to 3 Nov", "12 Oct" (from calendar dates, so the zone cannot move them).
  // Where the day or the month comes first is the device's: "Oct 12 to 18" on an American one.
  const noon = date => { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
  const partsOf = (date, opts) => { const o = {}; new Intl.DateTimeFormat(LOCALE, Object.assign({ timeZone: 'UTC' }, opts)).formatToParts(noon(date)).forEach(p => { o[p.type] = p.value; }); return o; };
  const shortDay = date => new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(noon(date));
  const dayMonth = date => new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(noon(date));
  function range(a, b) {
    if (!b || b === a) return dayMonth(a);
    const x = partsOf(a, { day: 'numeric', month: 'short' }), y = partsOf(b, { day: 'numeric', month: 'short' });
    if (x.month !== y.month) return `${dayMonth(a)} to ${dayMonth(b)}`;
    const dayFirst = dayMonth(a).indexOf(x.day) <= dayMonth(a).indexOf(x.month);
    return dayFirst ? `${x.day} to ${y.day} ${y.month}` : `${x.month} ${x.day} to ${y.day}`;
  }

  // zone: the teacher's time zone (the class's, else the course's), or null
  function create(zone, here) {
    const z = valid(zone) ? zone : null;
    const mine = here || deviceZone();
    // the student's own time, when it reads differently from the teacher's
    function beside(t) {
      if (!z || !mine || mine === z) return null;
      const dz = day(t, z), dm = day(t, mine), cz = clock(t, z), cm = clock(t, mine);
      if (dz === dm && cz === cm) return null;
      return dz === dm ? `That is ${cm} where you are.` : `That is ${cm} on ${weekdayName(t, mine)} where you are.`;
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
      // the pieces of a moment, for a screen that says the zone once for all its times: "Monday 12 October" and "18:00"
      day: t => day(t, z),
      clock: t => clock(t, z),
      beside,
      // the calendar date a moment falls on in the zone, and the instant a wall-clock time happens there
      civil: t => civil(t, z),
      wall: (date, time) => wall(date, time, z),
      // work due on a date is due when that date ends in the zone: 23:59, the last minute of it
      dueAt: date => wall(addDays(date, 1), '00:00', z) - 60000,
      // when a dated module opens: the start of its date in the teacher's zone
      opensAt: date => midnight(date, z),
      opens(date) {
        if (!z) return { main: day(midnight(date, null)), local: null };   // no zone: the date, on the student's own clock
        const t = midnight(date, z);
        return { main: `${day(t, z)}, ${clock(t, z)} ${label(z)}`, local: beside(t) };
      }
    };
  }
  // dayIn, clockIn and weekdayIn say an instant in any zone, for a screen that names its own zone (the class lists)
  window.LMWhen = { create, valid, midnight, wall, addDays, weekday, civil, shortDay, range, label, deviceZone, dayIn: day, clockIn: clock, weekdayIn: weekdayName };
})();
