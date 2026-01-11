// config/db.js
import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_INTERNAL_URL;

if (dbUrl) {
  console.log('📦 Database Source: Use DATABASE_URL');
} else {
  console.log('📦 Database Source: Standard ENV Credentials');
}

const sequelize = dbUrl
  ? new Sequelize(dbUrl, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: isProduction ? {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    } : {}
  })
  : new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST,
      dialect: 'postgres',
      logging: false,
    }
  );

// Export as default for ES6 import
export default sequelize;
