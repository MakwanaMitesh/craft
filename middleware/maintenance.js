const Setting = require('../models/Setting');

// Blocks public and customer traffic while maintenanceMode is on, but lets
// admins keep working so they can flip it back off.
async function maintenanceGate(req, res, next) {
  if (req.session.role === 'admin') return next();

  const settings = res.locals.settings || (await Setting.getSingleton());
  if (!settings.maintenanceMode) return next();

  return res.status(503).render('public/maintenance', { title: 'Down for maintenance' });
}

module.exports = maintenanceGate;
