const db = require('./db');

db.all('SELECT dni, nombre, apellido FROM afiliados LIMIT 10', [], (err, rows) => {
  if (err) {
    return console.error(err.message);
  }
  console.log('Afiliados en la base:', rows);
  db.close();
});