const express = require('express');
const cors = require('cors');
const path = require("path");

const app = express();
const PORT = 4009; // microservicio separado del principal

// ===============================
// MIDDLEWARES
// ===============================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use("/screenshots", express.static(path.join(__dirname, "screenshots")));

// ===============================
// RUTAS
// ===============================
app.use('/api/capturas', require('./routes/capturas.routes'));

// ===============================
// RUTA DE PRUEBA
// ===============================
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    servicio: 'API_CAPTURAS',
    estado: 'activo'
  });
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🟢 API CAPTURAS corriendo en http://localhost:${PORT}`);
});