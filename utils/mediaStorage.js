const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { cloudinary, isConfigured: cloudinaryConfigured } = require('../config/cloudinary');

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 80;
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'images', 'uploads');

// Every uploaded image — card photos, template thumbnails, the site logo —
// goes through the same pipeline: resize/re-encode with sharp (this both
// controls file size and validates the bytes are actually a decodable
// image, independent of the extension/mimetype check at upload time), then
// land in Cloudinary if configured, or local disk otherwise. Callers never
// need to know which backend is active — they just get back a URL/path
// that's safe to store on the model and serve directly.
async function processToBuffer(inputPath) {
  return sharp(inputPath)
    .rotate() // respect EXIF orientation before stripping it
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'celebracraft', resource_type: 'image' },
      (err, result) => (err ? reject(err) : resolve(result.secure_url))
    );
    stream.end(buffer);
  });
}

async function saveBufferLocally(buffer, baseFilename) {
  const filename = `${baseFilename}.jpg`;
  await fs.writeFile(path.join(LOCAL_UPLOAD_DIR, filename), buffer);
  return `/images/uploads/${filename}`;
}

// Takes a multer file object (disk storage) and returns the final
// stored URL/path, deleting the original temp upload either way.
async function storeImage(file) {
  const buffer = await processToBuffer(file.path);
  const baseFilename = path.parse(file.filename).name;

  const url = cloudinaryConfigured
    ? await uploadBufferToCloudinary(buffer)
    : await saveBufferLocally(buffer, baseFilename);

  await fs.unlink(file.path).catch(() => {}); // best-effort cleanup of multer's temp file
  return url;
}

async function storeImages(files) {
  return Promise.all(files.map((file) => storeImage(file)));
}

module.exports = { storeImage, storeImages };
