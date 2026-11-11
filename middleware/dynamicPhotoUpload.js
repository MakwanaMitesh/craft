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

// Builds the multer instance fresh on every request from the live (cached)
// Settings document, so an admin change to Settings → Uploads applies to
// the very next photo upload with no redeploy — unlike middleware/upload.js
// (admin thumbnails/stickers/logo), which stays on fixed limits since
// nothing in this Settings tab is meant to govern those.
function dynamicPhotoUpload(req, res, next) {
  const settings = res.locals.settings;
  const allowedTypes = (settings.uploads?.allowedFileTypes?.length ? settings.uploads.allowedFileTypes : ['jpg', 'jpeg', 'png', 'webp'])
    .map((t) => `.${String(t).replace(/^\./, '').toLowerCase()}`);
  const allowedSet = new Set(allowedTypes);
  const maxBytes = (settings.uploads?.maxPhotoSizeMB || 5) * 1024 * 1024;
  const maxCount = settings.uploads?.maxPhotosPerCard || 6;

  const upload = multer({
    storage,
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedSet.has(ext)) {
        return cb(new AppError(`Only ${allowedTypes.join(', ')} files are allowed.`, 400));
      }
      cb(null, true);
    },
    limits: { fileSize: maxBytes },
  }).array('photos', maxCount);

  upload(req, res, next);
}

module.exports = dynamicPhotoUpload;
