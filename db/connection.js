const mysql = require("mysql2/promise");

async function createDatabaseConnection() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Miguelito-2001",
    database: "streaming_platform",
  });
  return connection;
}

module.exports = {
  createDatabaseConnection,
};
