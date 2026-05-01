const fs = require('fs');
const path = require('path');

const sanitizeFolderToken = (value = '') => {
  const normalized = `${value}`
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'SIN_CRITERIO';
};

const hasOrderId = (id_orden) =>
  id_orden !== undefined &&
  id_orden !== null &&
  `${id_orden}`.trim() !== '';

const buildOutputFolderName = ({ placa, id_orden, output_key } = {}) => {
  if (output_key) return output_key;
  if (hasOrderId(id_orden)) return `orden_${id_orden}`;
  return `placa_${sanitizeFolderToken(placa)}`;
};

const ensureScreenshotDir = ({ baseDir, placa, id_orden, output_key }) => {
  const folderName = buildOutputFolderName({ placa, id_orden, output_key });
  const dir = path.join(baseDir, '..', 'screenshots', folderName);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return { dir, folderName };
};

const clearGeneratedScreenshots = ({ baseDir, folderName, siteKeys = [] }) => {
  const dir = path.join(baseDir, '..', 'screenshots', folderName);

  if (!fs.existsSync(dir)) return;

  for (const siteKey of siteKeys) {
    const filePath = path.join(dir, `${siteKey}.png`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
};

const buildImageUrl = (folderName, filename) => {
  if (!folderName || !filename) return null;
  return `/screenshots/${folderName}/${filename}`;
};

module.exports = {
  sanitizeFolderToken,
  hasOrderId,
  buildOutputFolderName,
  ensureScreenshotDir,
  clearGeneratedScreenshots,
  buildImageUrl
};
