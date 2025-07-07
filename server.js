// === BACKEND COMPLETO SIN /admin/listar-afiliados ===

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: 'https://evamendezs.github.io',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-admin-pin']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const dbPath = path.resolve(__dirname, 'afiliados.db');
const csvPath = path.resolve(__dirname, 'afiliados.csv');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('❌ Error al abrir la base de datos:', err.message);
  else {
    console.log('✅ Conectado a la base de datos SQLite.');
    inicializarTablasYDatos();
  }
});

function inicializarTablasYDatos() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS afiliados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nro_afiliado TEXT UNIQUE,
        nombre_completo TEXT,
        dni TEXT UNIQUE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        accion TEXT,
        dni TEXT,
        nombre_completo TEXT,
        nro_afiliado TEXT,
        fecha TEXT
      )
    `);

    db.get(`SELECT COUNT(*) AS count FROM afiliados`, (err, row) => {
      if (err) {
        console.error('Error al consultar afiliados:', err.message);
        return;
      }
      if (row.count === 0) {
        console.log('La tabla afiliados está vacía. Importando desde CSV...');
        importarCSV();
      } else {
        console.log('La tabla afiliados ya tiene datos.');
      }
    });
  });
}

function importarCSV() {
  const filas = [];
  fs.createReadStream(csvPath)
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
    .on('end', () => {
      if (filas.length === 0) return;
      const stmt = db.prepare(`INSERT OR IGNORE INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES (?, ?, ?)`);
      filas.forEach(({ nro_afiliado, nombre_completo, dni }) => {
        stmt.run(nro_afiliado, nombre_completo, dni);
      });
      stmt.finalize();
    })
    .on('error', (error) => {
      console.error('Error leyendo CSV:', error.message);
    });
}

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

app.post('/verificar', (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });

  db.get(`SELECT nro_afiliado, nombre_completo, dni FROM afiliados WHERE dni = ?`, [dni.trim()], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error en la base de datos' });
    res.json(row ? { afiliado: true, datos: row } : { afiliado: false });
  });
});

app.post('/credencial', async (req, res) => {
  const { dni } = req.body;
  if (!dni || !esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });

  db.get(`SELECT * FROM afiliados WHERE dni = ?`, [dni.trim()], async (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Afiliado no encontrado' });

    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([400, 300]);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const blue = rgb(0, 0.3, 0.6);
      const fecha = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });

      page.drawText('ASOCIACIÓN MUTUAL CAMIONEROS DE MENDOZA', {
        x: 20, y: 260, size: 14, font, color: blue
      });
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
});

app.post('/admin/cargar-afiliados', validarPin, (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  if (!esNumero(dni)) return res.status(400).json({ error: 'DNI inválido' });
  if (!esNumero(nro_afiliado)) return res.status(400).json({ error: 'N° Afiliado inválido' });

  db.get(`SELECT 1 FROM afiliados WHERE dni = ?`, [dni], (err, dniExiste) => {
    if (err) return res.status(500).json({ error: 'Error en la base' });
    if (dniExiste) return res.status(409).json({ error: 'El DNI ya existe' });

    db.get(`SELECT 1 FROM afiliados WHERE nro_afiliado = ?`, [nro_afiliado], (err2, nroExiste) => {
      if (err2) return res.status(500).json({ error: 'Error en la base' });
      if (nroExiste) return res.status(409).json({ error: 'El N° Afiliado ya existe' });

      db.run(`INSERT INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES (?, ?, ?)`,
        [nro_afiliado, nombre_completo, dni],
        function (err3) {
          if (err3) return res.status(500).json({ error: 'Error al insertar afiliado' });

          const fecha = new Date().toISOString();
          db.run(`INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES (?, ?, ?, ?, ?)`,
            ['Agregar', dni, nombre_completo, nro_afiliado, fecha],
            (logErr) => {
              if (logErr) console.error('⚠️ Error en log:', logErr.message);
              res.json({ success: true, message: 'Afiliado agregado' });
            });
        });
    });
  });
});

app.put('/admin/editar-afiliado', validarPin, (req, res) => {
  let { nro_afiliado, nombre_completo, dni } = req.body;
  if (!nro_afiliado || !nombre_completo || !dni) return res.status(400).json({ error: 'Faltan datos' });

  nro_afiliado = nro_afiliado.trim();
  nombre_completo = nombre_completo.trim();
  dni = dni.trim();

  db.run(`UPDATE afiliados SET nro_afiliado = ?, nombre_completo = ? WHERE dni = ?`,
    [nro_afiliado, nombre_completo, dni],
    function (err) {
      if (err) return res.status(500).json({ error: 'Error al modificar afiliado' });
      if (this.changes === 0) return res.status(404).json({ error: 'Afiliado no encontrado' });

      const fecha = new Date().toISOString();
      db.run(`INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES (?, ?, ?, ?, ?)`,
        ['Editar', dni, nombre_completo, nro_afiliado, fecha],
        (logErr) => {
          if (logErr) console.error('⚠️ Error en log editar:', logErr.message);
          res.json({ success: true, message: 'Afiliado modificado' });
        });
    });
});

app.post('/admin/eliminar-afiliado', validarPin, (req, res) => {
  const { dni } = req.body;
  if (!dni) return res.status(400).json({ error: 'Falta el DNI' });

  db.get(`SELECT * FROM afiliados WHERE dni = ?`, [dni.trim()], (err, row) => {
    if (err) return res.status(500).json({ error: 'Error en la base' });
    if (!row) return res.status(404).json({ error: 'Afiliado no encontrado' });

    db.run(`DELETE FROM afiliados WHERE dni = ?`, [dni.trim()], function (err2) {
      if (err2) return res.status(500).json({ error: 'Error al eliminar afiliado' });

      const fecha = new Date().toISOString();
      db.run(`INSERT INTO logs (accion, dni, nombre_completo, nro_afiliado, fecha) VALUES (?, ?, ?, ?, ?)`,
        ['Eliminar', row.dni, row.nombre_completo, row.nro_afiliado, fecha],
        (logErr) => {
          if (logErr) console.error('⚠️ Error en log eliminar:', logErr.message);
          res.json({ success: true, message: 'Afiliado eliminado' });
        });
    });
  });
});

app.get('/admin/listar-logs', validarPin, (req, res) => {
  db.all(`SELECT * FROM logs ORDER BY fecha DESC LIMIT 100`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Error al listar logs' });
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
