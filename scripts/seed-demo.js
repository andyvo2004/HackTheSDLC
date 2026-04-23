import 'dotenv/config';
import crypto from 'node:crypto';
import { db, initDb } from '../src/db.js';

const now = new Date().toISOString();
const uid = () => crypto.randomUUID();

async function seed() {
  await initDb();

  const existing = await db.get("SELECT id FROM payment_pages WHERE slug = 'yoga-class'");
  if (existing) {
    console.log('Demo data already exists — skipping.');
    process.exit(0);
  }

  // ── Page 1: Yoga Studio ────────────────────────────────────────────────────
  const yogaId = uid();
  await db.run(
    `INSERT INTO payment_pages
       (id, slug, title, description, brand_color, header_message, footer_message,
        amount_mode, fixed_amount, gl_codes_json, email_template,
        is_active, current_version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      yogaId,
      'yoga-class',
      'Morning Yoga Class',
      'Join us for our weekly morning yoga sessions. All skill levels welcome.',
      '#7C3AED',
      'Namaste! Please complete your registration below.',
      'Questions? Email us at yoga@studio.example.com',
      'fixed',
      25.00,
      JSON.stringify(['YOGA-001', 'FIT-2024']),
      null,
      1, 1, now, now,
    ],
  );
  console.log('✅ Created page: yoga-class');

  const yogaFields = [
    { label: 'Student Name',    type: 'text',     required: 1, order: 0, placeholder: 'Your full name', options: null },
    { label: 'Class Date',      type: 'date',     required: 1, order: 1, placeholder: null,             options: null },
    { label: 'Membership Type', type: 'dropdown', required: 1, order: 2, placeholder: null,             options: ['Drop-in', 'Monthly', 'Annual'] },
    { label: 'Special Requests',type: 'text',     required: 0, order: 3, placeholder: 'Injuries, preferences, etc.', options: null },
  ];
  const yogaFieldIds = [];
  for (const f of yogaFields) {
    const fid = uid();
    yogaFieldIds.push(fid);
    await db.run(
      `INSERT INTO custom_fields (id, page_id, label, type, options_json, required, placeholder, display_order)
       VALUES (?,?,?,?,?,?,?,?)`,
      [fid, yogaId, f.label, f.type, f.options ? JSON.stringify(f.options) : null, f.required, f.placeholder, f.order],
    );
  }
  console.log('✅ Created 4 custom fields for yoga-class');

  // ── Page 2: Municipal Parking ──────────────────────────────────────────────
  const parkingId = uid();
  const allStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC',
    'ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  await db.run(
    `INSERT INTO payment_pages
       (id, slug, title, description, brand_color, header_message, footer_message,
        amount_mode, min_amount, max_amount, gl_codes_json, email_template,
        is_active, current_version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      parkingId,
      'parking-fee',
      'Municipal Parking Payment',
      'Pay your parking fees securely online. Accepted 24/7.',
      '#0369A1',
      'City of Springfield — Parking Services',
      'Keep your transaction ID for your records.',
      'range',
      5.00,
      500.00,
      JSON.stringify(['PKG-REVENUE', 'MUNI-2024']),
      null,
      1, 1, now, now,
    ],
  );
  console.log('✅ Created page: parking-fee');

  const parkingFields = [
    { label: 'License Plate Number', type: 'text',     required: 1, order: 0, placeholder: 'e.g. ABC-1234',          options: null },
    { label: 'Vehicle State',        type: 'dropdown', required: 1, order: 1, placeholder: null,                     options: allStates },
    { label: 'Parking Duration',     type: 'dropdown', required: 1, order: 2, placeholder: null,                     options: ['1 Hour', '2 Hours', '4 Hours', 'All Day'] },
    { label: 'Citation Number',      type: 'text',     required: 0, order: 3, placeholder: 'If paying a citation',   options: null },
  ];
  const parkingFieldIds = [];
  for (const f of parkingFields) {
    const fid = uid();
    parkingFieldIds.push(fid);
    await db.run(
      `INSERT INTO custom_fields (id, page_id, label, type, options_json, required, placeholder, display_order)
       VALUES (?,?,?,?,?,?,?,?)`,
      [fid, parkingId, f.label, f.type, f.options ? JSON.stringify(f.options) : null, f.required, f.placeholder, f.order],
    );
  }
  console.log('✅ Created 4 custom fields for parking-fee');

  // ── Page Versions ──────────────────────────────────────────────────────────
  const buildConfig = (page, fields, fieldIds) => ({
    slug:          page.slug,
    title:         page.title,
    subtitle:      null,
    description:   page.description,
    logoUrl:       null,
    brandColor:    page.brand_color,
    headerMessage: page.header_message,
    footerMessage: page.footer_message,
    amountMode:    page.amount_mode,
    fixedAmount:   page.fixed_amount ?? null,
    minAmount:     page.min_amount ?? null,
    maxAmount:     page.max_amount ?? null,
    glCodes:       JSON.parse(page.gl_codes_json),
    emailTemplate: null,
    isActive:      true,
    customFields:  fields.map((f, i) => ({
      id:          fieldIds[i],
      label:       f.label,
      type:        f.type,
      options:     f.options ?? [],
      required:    Boolean(f.required),
      placeholder: f.placeholder ?? null,
      helperText:  null,
      order:       f.order,
    })),
  });

  const yogaPage    = { slug:'yoga-class',   title:'Morning Yoga Class',       description:'Join us for our weekly morning yoga sessions. All skill levels welcome.', brand_color:'#7C3AED', header_message:'Namaste! Please complete your registration below.', footer_message:'Questions? Email us at yoga@studio.example.com', amount_mode:'fixed',  fixed_amount:25,   min_amount:null, max_amount:null,  gl_codes_json:'["YOGA-001","FIT-2024"]' };
  const parkingPage = { slug:'parking-fee',  title:'Municipal Parking Payment', description:'Pay your parking fees securely online. Accepted 24/7.',                 brand_color:'#0369A1', header_message:'City of Springfield — Parking Services',            footer_message:'Keep your transaction ID for your records.',       amount_mode:'range', fixed_amount:null, min_amount:5,    max_amount:500,   gl_codes_json:'["PKG-REVENUE","MUNI-2024"]' };

  await db.run(
    `INSERT INTO payment_page_versions (id, page_id, version_number, config_json, published_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [uid(), yogaId, 1, JSON.stringify(buildConfig(yogaPage, yogaFields, yogaFieldIds)), null, now],
  );
  await db.run(
    `INSERT INTO payment_page_versions (id, page_id, version_number, config_json, published_by, created_at)
     VALUES (?,?,?,?,?,?)`,
    [uid(), parkingId, 1, JSON.stringify(buildConfig(parkingPage, parkingFields, parkingFieldIds)), null, now],
  );
  await db.run("UPDATE payment_pages SET last_published_at = ? WHERE id IN (?,?)", [now, yogaId, parkingId]);
  console.log('✅ Created 2 page versions');

  // ── Transactions ───────────────────────────────────────────────────────────
  const yogaTxPayers = [
    { name: 'Alice Chen',   email: 'alice@example.com' },
    { name: 'Bob Martinez', email: 'bob@example.com'   },
    { name: 'Carol Singh',  email: 'carol@example.com' },
  ];
  const yogaTxDates  = ['2026-04-10', '2026-04-14', '2026-04-17'];
  const yogaTxTypes  = ['Drop-in', 'Monthly', 'Annual'];

  for (let i = 0; i < 3; i++) {
    const txId = uid();
    const ref  = `pi_demo_yoga_${i + 1}`;
    await db.run(
      `INSERT INTO transactions (id, page_id, amount, payment_method, status, payer_name, payer_email, processor_ref, stripe_payment_intent_id, gl_codes_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [txId, yogaId, 25.00, 'card', 'success', yogaTxPayers[i].name, yogaTxPayers[i].email, ref, ref, JSON.stringify(['YOGA-001', 'FIT-2024']), new Date(2026, 3, 10 + i * 4).toISOString()],
    );
    // field_responses: Student Name, Class Date, Membership Type, Special Requests
    const responses = [yogaTxPayers[i].name, yogaTxDates[i], yogaTxTypes[i], ''];
    for (let j = 0; j < yogaFieldIds.length; j++) {
      await db.run(
        `INSERT INTO field_responses (id, transaction_id, field_id, value) VALUES (?,?,?,?)`,
        [uid(), txId, yogaFieldIds[j], responses[j]],
      );
    }
  }
  console.log('✅ Created 3 succeeded transactions on yoga-class');

  // Parking transaction
  const parkingTxId = uid();
  const parkingRef  = 'pi_demo_parking_1';
  await db.run(
    `INSERT INTO transactions (id, page_id, amount, payment_method, status, payer_name, payer_email, processor_ref, stripe_payment_intent_id, gl_codes_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [parkingTxId, parkingId, 12.00, 'card', 'success', 'David Park', 'david@example.com', parkingRef, parkingRef, JSON.stringify(['PKG-REVENUE', 'MUNI-2024']), new Date(2026, 3, 20).toISOString()],
  );
  const parkingResponses = ['XYZ-7890', 'CA', '1 Hour', ''];
  for (let j = 0; j < parkingFieldIds.length; j++) {
    await db.run(
      `INSERT INTO field_responses (id, transaction_id, field_id, value) VALUES (?,?,?,?)`,
      [uid(), parkingTxId, parkingFieldIds[j], parkingResponses[j]],
    );
  }
  console.log('✅ Created 1 succeeded transaction on parking-fee');

  // Failed transaction (yoga)
  const failedTxId = uid();
  const failedRef  = 'pi_demo_yoga_failed';
  await db.run(
    `INSERT INTO transactions (id, page_id, amount, payment_method, status, payer_name, payer_email, processor_ref, stripe_payment_intent_id, gl_codes_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [failedTxId, yogaId, 25.00, 'card', 'failed', 'Eve Thompson', 'eve@example.com', failedRef, failedRef, JSON.stringify(['YOGA-001', 'FIT-2024']), new Date(2026, 3, 21).toISOString()],
  );
  console.log('✅ Created 1 failed transaction on yoga-class');

  console.log('\n🎉 Demo seed complete. Total created:');
  console.log('   2 payment pages  (yoga-class, parking-fee)');
  console.log('   8 custom fields');
  console.log('   2 page versions');
  console.log('   5 transactions (4 succeeded, 1 failed)');
  console.log('   16 field responses');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
