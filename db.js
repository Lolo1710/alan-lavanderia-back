import mysql from "mysql2/promise";

const db = mysql.createPool({
    host: "61.247.177.142",       // Cambia a tu host
    user: "cvjajcco_alan",            // Usuario de tu DB
    password: "AlanUriel2026.!",            // Contraseña de tu DB
    database: "cvjajcco_lavanderia",
    port: 3306,
});

export { db };
