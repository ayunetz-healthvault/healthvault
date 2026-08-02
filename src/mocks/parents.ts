import type { ParentProfile } from '@/types/domain';

/**
 * Seed profiles.
 *
 * Two parents with genuinely different care patterns — one managing chronic
 * diabetes and hypertension, one post-surgery — so the dashboard, timeline and
 * follow-up screens all have something realistic to show on first launch.
 */
export const MOCK_PARENTS: ParentProfile[] = [
  {
    id: 'par_demo_amma',
    fullName: 'Lakshmi Iyer',
    relationship: 'mother',
    dateOfBirth: '1955-04-18',
    bloodGroup: 'B+',
    city: 'Chennai',
    phone: '+91 98400 12345',
    conditions: ['Type 2 diabetes', 'Hypertension'],
    allergies: ['Sulfa drugs'],
    primaryDoctor: 'Dr. Meera Krishnan, Apollo Clinic Adyar',
    notes: 'Prefers morning appointments. Uses a walking stick for longer distances.',
    avatarColor: '#0E7C66',
    createdAt: '2026-01-12T09:00:00.000Z',
    updatedAt: '2026-07-14T11:20:00.000Z',
  },
  {
    id: 'par_demo_appa',
    fullName: 'Ramesh Iyer',
    relationship: 'father',
    dateOfBirth: '1951-11-02',
    bloodGroup: 'O+',
    city: 'Chennai',
    phone: '+91 98410 67890',
    conditions: ['Knee replacement (right, Mar 2026)', 'High cholesterol'],
    allergies: [],
    primaryDoctor: 'Dr. Suresh Babu, Kauvery Hospital',
    notes: 'Physiotherapy twice a week. Hard of hearing — call on video where possible.',
    avatarColor: '#1E6BB8',
    createdAt: '2026-01-12T09:05:00.000Z',
    updatedAt: '2026-06-30T07:45:00.000Z',
  },
];
