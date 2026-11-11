// "1st"/"2nd"/"3rd"/"4th"... — shared between the Anniversary create page's
// server-side calculation and anywhere else that needs to display one.
function ordinalSuffix(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

// How many full years have passed since `togetherDate`, plus one — i.e.
// "this will be your Nth anniversary", referring to the next one coming up
// rather than the last one that already happened.
function calcAnniversaryNumber(togetherDate, today = new Date()) {
  let years = today.getFullYear() - togetherDate.getFullYear();
  const monthDiff = today.getMonth() - togetherDate.getMonth();
  const dayDiff = today.getDate() - togetherDate.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years -= 1;
  return Math.max(years, 0) + 1;
}

module.exports = { ordinalSuffix, calcAnniversaryNumber };
