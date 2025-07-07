const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('./db');

const archivoCSV = path.resolve(__dirname, 'afiliados.csv');

const cargarAfiliados = () => {
  const afiliados = [];

  fs.createReadStream(archivoCSV)
    .pipe(csv({ headers: ['nro_afiliado', 'nombre_completo', 'dni'] }))
    .on('data', (row) => {
      console.log('Fila detectada:', row);

      const nro = (row.nro_afiliado || '').trim();
      const nombre = (row.nombre_completo || '').trim();
      const dni = (row.dni || '').trim();

      if (nro && nombre && dni) {
        afiliados.push({ nro_afiliado: nro, nombre_completo: nombre, dni });
      }
    })
    .on('end', () => {
      console.log(`📦 Inicio de carga de ${afiliados.length} afiliados válidos...`);

      db.serialize(() => {
        const stmt = db.prepare(
          'INSERT OR IGNORE INTO afiliados (nro_afiliado, nombre_completo, dni) VALUES (?, ?, ?)'
        );

        afiliados.forEach(({ nro_afiliado, nombre_completo, dni }) => {
          console.log(`Insertando: ${nro_afiliado} | ${nombre_completo} | ${dni}`);
          stmt.run(nro_afiliado, nombre_completo, dni);
        });

        stmt.finalize(() => {
          console.log('✅ Carga de afiliados finalizada');
          db.close();
        });
      });
    })
    .on('error', (error) => {
      console.error('❌ Error leyendo el archivo CSV:', error);
    });
};

cargarAfiliados();