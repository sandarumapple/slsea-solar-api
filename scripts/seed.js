require('dotenv').config();

const bcrypt = require('bcryptjs');
const connectDb = require('../src/config/db');
const {
  Province,
  District,
  GridSubstation,
  SolarInstallation,
  GenerationReading,
  User
} = require('../src/models');

const areas = [
  ['Western', ['Colombo', 'Gampaha', 'Kalutara']],
  ['Central', ['Kandy', 'Matale', 'Nuwara Eliya']],
  ['Southern', ['Galle', 'Matara', 'Hambantota']],
  ['Northern', ['Jaffna', 'Kilinochchi', 'Mannar', 'Mullaitivu', 'Vavuniya']],
  ['Eastern', ['Trincomalee', 'Batticaloa', 'Ampara']],
  ['North Western', ['Kurunegala', 'Puttalam']],
  ['North Central', ['Anuradhapura', 'Polonnaruwa']],
  ['Uva', ['Badulla', 'Monaragala']],
  ['Sabaragamuwa', ['Ratnapura', 'Kegalle']]
];

const run = async () => {
  const password = process.env.SEED_PASSWORD || '';
  if (password.length < 16 || password === 'DemoPass123!' || /choose-a|replace-with|YOUR_/i.test(password))
    throw new Error('Set a private SEED_PASSWORD of at least 16 characters before seeding any database.');
  require('../src/config/env')({ requireDatabase: true });
  await connectDb();
  await Promise.all(
    [
      Province,
      District,
      GridSubstation,
      SolarInstallation,
      GenerationReading,
      User
    ].map((model) => model.init())
  );

  const models = [Province, District, GridSubstation, SolarInstallation, GenerationReading, User];
  const occupied = await Promise.all(models.map((model) => model.exists({})));
  if (occupied.some(Boolean) && !process.argv.includes('--reset')) {
    throw new Error('Database already contains coursework data. Nothing was deleted. Use npm run seed -- --reset only when you intend to replace all six collections.');
  }
  if (process.argv.includes('--reset')) {
    await Promise.all(models.map((model) => model.deleteMany({})));
  }

  const provinces = await Province.insertMany(
    areas.map(([name], i) => ({
      name,
      code: `P${i + 1}`
    }))
  );

  let districts = [];

  for (let i = 0; i < areas.length; i++) {
    for (const name of areas[i][1]) {
      districts.push({
        name,
        province: provinces[i]._id
      });
    }
  }

  districts = await District.insertMany(districts);

  const subs = await GridSubstation.insertMany(
    Array.from({ length: 25 }, (_, i) => ({
      name: `${districts[i % districts.length].name} Grid ${Math.floor(i / districts.length) + 1}`,
      code: `SS${String(i + 1).padStart(3, '0')}`,
      district: districts[i % districts.length]._id
    }))
  );

  const installations = await SolarInstallation.insertMany(
    Array.from({ length: 200 }, (_, i) => ({
      installationId: `SLSEA-${String(i + 1).padStart(4, '0')}`,
      ownerName: `Solar Owner ${i + 1}`,
      meterId: `METER-${String(i + 1).padStart(5, '0')}`,
      inverterId: `INV-${i + 1}`,
      capacityKw: [3, 5, 7, 10][i % 4],
      substation: subs[i % subs.length]._id,
      active: true
    }))
  );

  const start = new Date(
    Math.floor(Date.now() / 900000) * 900000 - 7 * 96 * 900000
  );

  const readings = [];

  for (const ins of installations) {
    let energy = 1000 + Math.random() * 10000;

    for (let q = 0; q <= 7 * 96; q++) {
      const time = new Date(start.getTime() + q * 900000);
      const h = (time.getUTCHours() + time.getUTCMinutes() / 60 + 5.5) % 24;
      const daylight =
        h >= 6 && h <= 18 ? Math.sin((Math.PI * (h - 6)) / 12) : 0;
      const power = +Math.max(
        0,
        daylight * ins.capacityKw * (0.75 + Math.random() * 0.25)
      ).toFixed(2);

      energy += power * 0.25;

      readings.push({
        installation: ins._id,
        timestamp: time,
        powerKw: power,
        cumulativeEnergyKwh: +energy.toFixed(2),
        voltage: +(225 + Math.random() * 10).toFixed(1)
      });
    }
  }

  await GenerationReading.insertMany(readings, { ordered: false });

  const hash = await bcrypt.hash(password, 12);

  await User.insertMany([
    {
      name: 'SLSEA Admin',
      email: 'admin@slsea.lk',
      passwordHash: hash,
      role: 'ADMIN',
      jurisdictionType: 'NATIONAL'
    },
    {
      name: 'Western Officer',
      email: 'western@slsea.lk',
      passwordHash: hash,
      role: 'PROVINCE_OFFICER',
      jurisdictionType: 'PROVINCE',
      jurisdictionRef: provinces[0]._id,
      jurisdictionModel: 'Province'
    },
    {
      name: 'Colombo Officer',
      email: 'colombo@slsea.lk',
      passwordHash: hash,
      role: 'DISTRICT_OFFICER',
      jurisdictionType: 'DISTRICT',
      jurisdictionRef: districts[0]._id,
      jurisdictionModel: 'District'
    },
    ...installations.map((installation, index) => ({
      name: `Device ${index + 1}`,
      email: `device${index + 1}@slsea.lk`,
      passwordHash: hash,
      role: 'DEVICE',
      jurisdictionType: 'INSTALLATION',
      jurisdictionRef: installation._id,
      jurisdictionModel: 'SolarInstallation'
    }))
  ]);

  console.log(
    `Seeded ${provinces.length} provinces, ${districts.length} districts, ${subs.length} substations, ${installations.length} installations, ${readings.length} readings.`
  );

  process.exit(0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
