import sequelize from './config/db.js';

const fixDatabase = async () => {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to Database');

        // Drop the foreign key constraint
        try {
            await sequelize.getQueryInterface().removeConstraint('jobs', 'jobs_oracle_ccid_fkey');
            console.log('✅ Successfully removed constraint: jobs_oracle_ccid_fkey');
        } catch (err) {
            console.log('⚠️ Could not remove constraint (might not exist):', err.message);
        }

        // Also try dropping it by raw query just in case the name differs in some environments
        try {
            await sequelize.query('ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "jobs_oracle_ccid_fkey";');
            console.log('✅ Executed raw SQL to drop constraint.');
        } catch (err) {
            console.error('❌ SQL Error:', err.message);
        }

    } catch (error) {
        console.error('❌ Connection failed:', error);
    }
    // DO NOT CLOSE CONNECTION - It is shared with the app
    // finally {
    //    await sequelize.close();
    // }
};

fixDatabase();
