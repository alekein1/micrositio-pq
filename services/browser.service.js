const { chromium } = require('playwright');

const launchOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage'
  ]
};

exports.getBrowser = async () => {
  // Cada solicitud recibe su propio navegador para evitar
  // reutilizar instancias ya cerradas entre consultas consecutivas.
  return chromium.launch(launchOptions);
};
