// Shared game-day clock for Daily, Daily Hard, Past 7, and the admin page.
//
// The puzzle day is the Pacific calendar date, and it rolls at 1:00 AM
// America/Los_Angeles (PST or PDT, whichever is in effect). Every player
// worldwide is therefore on the same puzzle. The YYYY-MM-DD string is still
// what seeds the puzzle and what Firestore stores — only the moment the date
// advances has changed.

const GAME_DAY_TIME_ZONE = 'America/Los_Angeles';
const GAME_DAY_RESET_HOUR = 1;

/**
 * YYYY-MM-DD of the game day that contains `now`.
 * Before 1:00 AM Pacific, this is still the previous Pacific calendar date.
 */
function gameDayString(now) {
    const instant = now instanceof Date ? now : new Date();
    const parts = {};
    const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: GAME_DAY_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);
    for (let i = 0; i < formatted.length; i++) {
        if (formatted[i].type !== 'literal') parts[formatted[i].type] = formatted[i].value;
    }

    let year = Number(parts.year);
    let month = Number(parts.month);
    let day = Number(parts.day);
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0;

    if (hour < GAME_DAY_RESET_HOUR) {
        return shiftGameDay(
            `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            -1
        );
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Move a YYYY-MM-DD calendar date by `deltaDays`, independent of the viewer's timezone. */
function shiftGameDay(dateStr, deltaDays) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day));
    utc.setUTCDate(utc.getUTCDate() + deltaDays);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
