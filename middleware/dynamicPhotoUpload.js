const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const AppError = require('../utils/AppError');

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'images', 'uploads'));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${nanoid(12)}${ext}`);
  },
});

// Shared by both exports below — reads live (cached) Settings → Uploads so
// an admin change applies to the very next upload with no redeploy, unlike
// middleware/upload.js (admin thumbnails/stickers/logo), which stays on
// fixed limits since nothing in this Settings tab is meant to govern those.
function buildMulterOptions(res) {
  const settings = res.locals.settings;
  const allowedTypes = (settings.uploads?.allowedFileTypes?.length ? settings.uploads.allowedFileTypes : ['jpg', 'jpeg', 'png', 'webp'])
    .map((t) => `.${String(t).replace(/^\./, '').toLowerCase()}`);
  const allowedSet = new Set(allowedTypes);
  const maxBytes = (settings.uploads?.maxPhotoSizeMB || 5) * 1024 * 1024;

  return {
    storage,
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedSet.has(ext)) {
        return cb(new AppError(`Only ${allowedTypes.join(', ')} files are allowed.`, 400));
      }
      cb(null, true);
    },
    limits: { fileSize: maxBytes },
  };
}

// For a single flat "photos" field (the birthday/apology wizards) — field
// count capped by Settings → Uploads → max photos per card.
function dynamicPhotoUpload(req, res, next) {
  const settings = res.locals.settings;
  const maxCount = settings.uploads?.maxPhotosPerCard || 6;
  const upload = multer(buildMulterOptions(res)).array('photos', maxCount);
  upload(req, res, next);
}

// For forms with several independently-named optional file fields (e.g. one
// photo per Anniversary timeline moment, up to 8 of them) — any field name
// is accepted, up to `maxFiles` total, since which moments actually have a
// photo varies per submission.
function dynamicAnyUpload(maxFiles) {
  return function handler(req, res, next) {
    const options = buildMulterOptions(res);
    const upload = multer({ ...options, limits: { ...options.limits, files: maxFiles } }).any();
    upload(req, res, next);
  };
}

module.exports = dynamicPhotoUpload;
module.exports.any = dynamicAnyUpload;
