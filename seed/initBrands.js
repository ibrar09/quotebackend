import { ClientGroup } from '../models/index.js';

const ALSHAYA_BRANDS = [
    'RAISING CANES', 'COMMON AREA', 'H&M', 'REG.ADMIN OFFICE', 'P.F CHANGS',
    'STARBUCKS', 'STARBUCKS 2', 'CHEESECAKE FACTORY', 'AMERICAN EAGLE',
    'CLAIRES', 'BBW', 'NEXT', 'SHAKE SHACK', 'FOOT LOCKER',
    'TEXAS ROAD HOUSE', 'CHARLOTTE TILBURY', 'MILANO', 'PINKBERRY'
];

export const startBrandSeeding = async () => {
    try {
        const count = await ClientGroup.count({ where: { group_name: 'Alshaya' } });

        if (count === 0) {
            console.log('🌱 [SEED] Client Group "Alshaya" is empty. Seeding brands...');
            const payload = ALSHAYA_BRANDS.map(brand => ({
                group_name: 'Alshaya',
                brand_name: brand
            }));

            await ClientGroup.bulkCreate(payload);
            console.log(`✅ [SEED] Successfully seeded ${payload.length} brands!`);
        } else {
            console.log(`ℹ️ [SEED] Alshaya brands already exist (${count}). Skipping seed.`);
        }
    } catch (error) {
        console.error('❌ [SEED] Failed to seed brands:', error);
    }
};
