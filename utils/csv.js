// Shared CSV helpers for every admin list export. The leading-apostrophe
// neutralization guards against formula injection (=, +, -, @ at the start
// of a cell) in any user-controlled column — names, emails, messages —
// which Excel/Sheets would otherwise execute as a live formula the moment
// an admin opens the file.
function escapeCsv(value) {
  let str = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

function toCsv(header, rows) {
  const lines = [header.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(','));
  }
  return lines.join('\n');
}

function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(header, rows));
}

module.exports = { escapeCsv, toCsv, sendCsv };
