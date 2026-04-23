import 'dotenv/config';
import { initDb } from '../src/db.js';

async function seed() {
  await initDb();
  console.log('Demo seed complete (Supabase-backed init).');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
