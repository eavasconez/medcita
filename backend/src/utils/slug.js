const crypto = require('crypto');

const MAX_BASE_LENGTH = 40;

// 'Dra. Camila Torres' -> 'dra-camila-torres': lowercase ASCII letters and digits
// separated by single dashes.
function slugify(text) {
  const slug = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '');
  return slug || 'consultorio';
}

// A slug that is practically unique without asking the database first: the
// slugified name plus a short random suffix. The column is unique anyway, so a
// collision (about 1 in 16 million per name) surfaces as an error to retry.
const randomSlug = (text) => `${slugify(text)}-${crypto.randomBytes(3).toString('hex')}`;

module.exports = { slugify, randomSlug };
