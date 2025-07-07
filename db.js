const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.resolve(__dirname, 'afiliados.db'), (err) => {
  if (err) {
    console.error('Error abriendo la DB:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite.');
  }
});

// Cambiar la tabla para que tenga estos campos:
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS afiliados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nro_afiliado TEXT UNIQUE,
      nombre_completo TEXT,
      dni TEXT UNIQUE
    )
  `);
});

module.exports = db;