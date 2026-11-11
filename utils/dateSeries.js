function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Turns a sparse { _id: 'YYYY-MM-DD', total }[] aggregation result into
// parallel labels/values arrays covering every day in the window, so charts
// never show a gap for a day with no activity.
function fillDailySeries(rows, fromDate, days) {
  const byDay = new Map(rows.map((r) => [r._id, r.total]));
  const labels = [];
  const values = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(fromDate);
    day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    labels.push(key);
    values.push(byDay.get(key) || 0);
  }
  return { labels, values };
}

module.exports = { startOfDay, fillDailySeries };
