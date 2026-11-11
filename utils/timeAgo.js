// Formats a past Date as a short relative string ("2 hours ago"), for
// surfacing "last opened ..." on the customer dashboard without a client
// library — coarse by design, not meant for anything precise.
function timeAgo(date) {
  if (!date) return null;
  const seconds = Math.max(Math.floor((Date.now() - new Date(date).getTime()) / 1000), 0);

  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [label, secondsPerUnit] of units) {
    const value = Math.floor(seconds / secondsPerUnit);
    if (value >= 1) return `${value} ${label}${value === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

module.exports = { timeAgo };
