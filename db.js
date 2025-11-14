import mysql from "mysql2/promise";

export const db = mysql.createPool({
    host: "174.136.28.105",
    user: "cvjajcco_alan",
    password: "jajajojo2025.",
    database: "cvjajcco_lavanderia",
});
