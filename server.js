if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = [
  'https://evamendezs.github.io',
  'https://mutualcamionerosmza.github.io'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('CORS no permitido para el origen: ' + origin), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PG_CONNECTION_STRING = process.env.PG_CONNECTION_STRING;

if (!PG_CONNECTION_STRING) {
  console.error("❌ ERROR: La variable de entorno PG_CONNECTION_STRING no está definida.");
  process.exit(1);
}

const client = new Client({ connectionString: PG_CONNECTION_STRING });

async function conectarPG() {
  try {
    await client.connect();
    console.log('✅ Conectado a PostgreSQL');
  } catch (err) {
    console.error('❌ Error conectando a PostgreSQL:', err.message);
    process.exit(1);
  }
}
conectarPG();

async function inicializarTablasYDatos() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS afiliados (
      id SERIAL PRIMARY KEY,
      nro_afiliado TEXT UNIQUE,
      nombre_completo TEXT NOT NULL,
      dni TEXT UNIQUE NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      accion TEXT,
      dni TEXT,
      nombre_completo TEXT,
      nro_afiliado TEXT,
      fecha TIMESTAMP
    )
  `);

  const res = await client.query(`SELECT COUNT(*) FROM afiliados`);
  if (parseInt(res.rows[0].count, 10) === 0) {
    console.log('La tabla afiliados está vacía. Importando desde CSV...');
    await importarCSV();
  } else {
    console.log('La tabla afiliados ya tiene datos.');
  }
}

async function importarCSV() {
  return new Promise((resolve, reject) => {
    const filas = [];
    fs.createReadStream(path.resolve(__dirname, 'afiliados.csv'))
      .pipe(csv({
        mapHeaders: ({ header, index }) => {
          if (index === 0) return 'nro_afiliado';
          if (index === 1) return 'nombre_completo';
          if (index === 2) return 'dni';
          return null;
        }
      }))
      .on('data', (data) => {
        if (data.nro_afiliado && data.nombre_completo && data.dni) {
          filas.push({
            nro_afiliado: data.nro_afiliado.trim(),
            nombre_completo: data.nombre_completo.trim(),
            dni: data.dni.trim()
          });
        }
      })
      .on('end', async () => {
        try {
          for (const f of filas) {
            await client.query(
              `INSERT INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
              [f.nro_afiliado, f.nombre_completo, f.dni]
            );
          }
          console.log(`✅ Importados ${filas.length} afiliados desde CSV`);
          resolve();
        } catch (err) {
          console.error('❌ Error importando CSV:', err.message);
          reject(err);
        }
      })
      .on('error', (error) => {
        console.error('❌ Error leyendo CSV:', error.message);
        reject(error);
      });
  });
}

inicializarTablasYDatos();

const ADMIN_PIN = '1906';

function validarPin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body.pin || req.query.pin;
  if (pin === ADMIN_PIN) next();
  else res.status(403).json({ error: 'PIN inválido' });
}

function esNumero(str) {
  return /^\d+$/.test(str);
}

// === RUTAS ===

app.post('/verificar', async (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });

  try {
    const result = await client.query('SELECT nro_afiliado, nombre_completo, dni FROM afiliados WHERE dni = $1', [dni.trim()]);
    res.json(result.rows.length > 0 ? { afiliado: true, datos: result.rows[0] } : { afiliado: false });
  } catch (err) {
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/credencial', async (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });

  try {
    const result = await client.query('SELECT * FROM afiliados WHERE dni = $1', [dni.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

    const row = result.rows[0];
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([400, 300]);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const blue = rgb(0, 0.3, 0.6);
    const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });

    page.drawText('ASOCIACIÓN MUTUAL CAMIONEROS DE MENDOZA', { x: 20, y: 260, size: 14, font, color: blue });
    page.drawText(`Nombre: ${row.nombre_completo}`, { x: 20, y: 230, size: 12, font, color: blue });
    page.drawText(`DNI: ${row.dni}`, { x: 20, y: 210, size: 12, font, color: blue });
    page.drawText(`N° Afiliado: ${row.nro_afiliado}`, { x: 20, y: 190, size: 12, font, color: blue });
    page.drawText(`Fecha de solicitud: ${fecha}`, { x: 20, y: 170, size: 10, font, color: blue });

    const logoPath = path.resolve(__dirname, 'assets', 'LogoMutual.png');
    const logoImage = await pdfDoc.embedPng(fs.readFileSync(logoPath));
    page.drawImage(logoImage, { x: 75, y: 0, width: 250, height: 200 });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=credencial.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch (error) {
    res.status(500).json({ error: 'Error generando el PDF' });
  }
});

app.post('/admin/cargar-afiliados', validarPin, async (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  if (!esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  if (!esNumero(nro_afiliado)) return res.status(400).json({ error: 'N° Afiliado inválido' });

  try {
    const dniExiste = await client.query('SELECT 1 FROM afiliados WHERE dni = $1', [dni]);
    if (dniExiste.rowCount > 0) return res.status(409).json({ error: 'El DNI ya existe' });

    const nroExiste = await client.query('SELECT 1 FROM afiliados WHERE nro_afiliado = $1', [nro_afiliado]);
    if (nroExiste.rowCount > 0) return res.status(409).json({ error: 'El N° Afiliado ya existe' });

    await client.query('INSERT INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES ($1, $2, $3)', [nro_afiliado, nombre_completo, dni]);

    const fecha = new Date().toISOString();
    await client.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1, $2, $3, $4, $5)',
      ['Agregar', dni, nombre_completo, nro_afiliado, fecha]
    );

    res.json({ success: true, message: 'Afiliado agregado' });
  } catch (err) {
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.put('/admin/editar-afiliado', validarPin, async (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  try {
    const result = await client.query(
      'UPDATE afiliados SET nro_afiliado = $1, nombre_completo = $2 WHERE dni = $3',
      [nro_afiliado, nombre_completo, dni]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

    const fecha = new Date().toISOString();
    await client.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1, $2, $3, $4, $5)',
      ['Editar', dni, nombre_completo, nro_afiliado, fecha]
    );

    res.json({ success: true, message: 'Afiliado modificado' });
  } catch (err) {
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.post('/admin/eliminar-afiliado', validarPin, async (req, res) => {
  const { dni } = req.body;
  if (!dni) return res.status(400).json({ error: 'Falta el DNI' });

  try {
    const result = await client.query('SELECT * FROM afiliados WHERE dni = $1', [dni.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

    const row = result.rows[0];
    await client.query('DELETE FROM afiliados WHERE dni = $1', [dni.trim()]);

    const fecha = new Date().toISOString();
    await client.query(
      'INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES ($1, $2, $3, $4, $5)',
      ['Eliminar', row.dni, row.nombre_completo, row.nro_afiliado, fecha]
    );

    res.json({ success: true, message: 'Afiliado eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error en la base de datos' });
  }
});

app.get('/admin/listar-logs', validarPin, async (req, res) => {
  try {
    const result = await client.query('SELECT * FROM logs ORDER BY fecha DESC LIMIT 100');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al listar logs' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});