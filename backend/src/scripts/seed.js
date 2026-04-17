import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Floor } from '../models/Floor.js';
import { Room } from '../models/Room.js';
import { AIRule } from '../models/AIRule.js';
import { hashPassword } from '../utils/password.js';

const rules = [
  {
    incidentType: 'Fire',
    label: 'Fire response playbook',
    priorityWeight: 1.05,
    responseSteps: [
      'Activate nearest fire alarm.',
      'Evacuate patients, visitors, and staff safely.',
      'Do not use elevators.',
      'Move critical patients with emergency support teams.',
      'Transfer control to fire department.'
    ],
    escalationHints: ['Smoke spread requires full building evacuation.']
  },
  {
    incidentType: 'Medical',
    label: 'Medical emergency playbook',
    priorityWeight: 1.08,
    responseSteps: [
      'Alert code team immediately.',
      'Start CPR if needed.',
      'Bring crash cart and AED.',
      'Prepare patient handoff for doctors.'
    ],
    escalationHints: ['Critical patient requires ICU escalation.']
  },
  {
    incidentType: 'Theft',
    label: 'Security theft playbook',
    priorityWeight: 1,
    responseSteps: [
      'Secure area.',
      'Check CCTV footage.',
      'Notify hospital security.',
      'Record missing items.'
    ],
    escalationHints: ['If staff involved, notify administration.']
  },
  {
    incidentType: 'Violence',
    label: 'Violence control playbook',
    priorityWeight: 1.1,
    responseSteps: [
      'Call security immediately.',
      'Protect patients and staff.',
      'Lock sensitive areas.',
      'Inform police if required.'
    ],
    escalationHints: ['Weapon threat requires police response.']
  }
];

async function run() {
  await connectDb();

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@hospital.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin123!';

  const existing = await User.findOne({ email });

  if (!existing) {
    await User.create({
      name: 'Hospital Admin',
      email,
      passwordHash: await hashPassword(password),
      role: 'Admin'
    });
    console.log('Admin created');
  }

  await Floor.deleteMany({});
  await Room.deleteMany({});

  const hospitalData = [
    {
      label: 'Ground Floor - Emergency & Reception',
      level: 0,
      rooms: [
        'Reception',
        'Emergency Ward',
        'Trauma Room',
        'Triage Room',
        'Billing Counter',
        'Pharmacy',
        'Security Office',
        'Waiting Hall'
      ]
    },
    {
      label: 'Floor 1 - OPD & Consultation',
      level: 1,
      rooms: [
        '101 Cardiology',
        '102 Neurology',
        '103 Orthopedics',
        '104 Pediatrics',
        '105 ENT',
        '106 Dermatology',
        '107 Dental',
        '108 Consultation Lounge',
        '109 Diagnostics'
      ]
    },
    {
      label: 'Floor 2 - ICU & Critical Care',
      level: 2,
      rooms: [
        '201 ICU Bed A',
        '202 ICU Bed B',
        '203 ICU Bed C',
        '204 Ventilator Room',
        '205 Dialysis',
        '206 Isolation Room',
        '207 Nurse Station',
        '208 Critical Lab',
        '209 Family Waiting'
      ]
    },
    {
      label: 'Floor 3 - General Wards',
      level: 3,
      rooms: [
        '301 Ward A',
        '302 Ward B',
        '303 Ward C',
        '304 Ward D',
        '305 Private Room',
        '306 Deluxe Room',
        '307 Nurse Bay',
        '308 Linen Store',
        '309 Pantry'
      ]
    },
    {
      label: 'Floor 4 - Operation Theatres',
      level: 4,
      rooms: [
        '401 OT-1',
        '402 OT-2',
        '403 OT-3',
        '404 Recovery Room',
        '405 Sterilization',
        '406 Surgeon Prep',
        '407 Anesthesia Room',
        '408 Blood Storage',
        '409 OT Control'
      ]
    },
    {
      label: 'Floor 5 - Maternity & Neonatal',
      level: 5,
      rooms: [
        '501 Labor Room',
        '502 Delivery Room',
        '503 NICU A',
        '504 NICU B',
        '505 Nursery',
        '506 Mother Care',
        '507 Lactation Room',
        '508 Pediatric Support',
        '509 Family Lounge'
      ]
    },
    {
      label: 'Floor 6 - Administration & Staff',
      level: 6,
      rooms: [
        '601 CEO Office',
        '602 HR Office',
        '603 Accounts',
        '604 IT Room',
        '605 Conference Hall',
        '606 Staff Lounge',
        '607 Records Room',
        '608 Maintenance',
        '609 Cafeteria'
      ]
    }
  ];

  for (const item of hospitalData) {
    const floor = await Floor.create({
      label: item.label,
      level: item.level,
      building: 'Main Hospital'
    });

    for (const room of item.rooms) {
      await Room.create({
        floor: floor._id,
        name: room,
        code: room.replace(/\s/g, '-').toUpperCase()
      });
    }
  }

  for (const r of rules) {
    await AIRule.findOneAndUpdate(
      { incidentType: r.incidentType },
      { $set: { ...r, active: true } },
      { upsert: true }
    );
  }

  console.log('Hospital data seeded successfully');

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});