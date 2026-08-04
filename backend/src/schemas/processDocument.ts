import { z } from 'zod';

import { ProcessingError, type PatientRedactionProfile } from '../types/processing.js';

/**
 * Form fields for `POST /dev/process-document`.
 *
 * Mirrors phase-1.md § "API contract". `patientName` is required because it is
 * the redactor's strongest signal — see ADR-002 § "Layer 1". Processing a
 * document without knowing whose name to remove would mean relying on pattern
 * matching alone, which is precisely the single-layer approach that ADR ruled
 * out.
 */

const DOCUMENT_CATEGORIES = [
  'lab_report',
  'prescription',
  'discharge_summary',
  'imaging',
  'consultation_note',
  'insurance',
  'other',
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'must be a real date' });

/** Repeated multipart fields arrive as several values under one name. */
const stringList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  });

export const processDocumentFieldsSchema = z.object({
  parentId: z.string().min(1).max(128),
  documentId: z.string().min(1).max(128),
  category: z.enum(DOCUMENT_CATEGORIES),
  documentDate: isoDate.optional(),
  patientName: z.string().min(1).max(200),
  patientNameAliases: stringList,
  patientDateOfBirth: isoDate.optional(),
  patientPhone: z.string().min(1).max(40).optional(),
  patientCity: z.string().min(1).max(120).optional(),
  knownPatientIds: stringList,
});

export type ProcessDocumentFields = z.infer<typeof processDocumentFieldsSchema>;

/**
 * Validates the collected fields.
 *
 * On failure the response names the offending *fields* and never quotes their
 * values. Zod's default messages would happily echo a rejected enum value back
 * to the caller, and these fields carry a patient's name, phone number and date
 * of birth.
 */
export const parseFields = (raw: Record<string, string | string[]>): ProcessDocumentFields => {
  const parsed = processDocumentFieldsSchema.safeParse(raw);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].sort();

    throw new ProcessingError('invalid_file', 'The request is missing or has invalid fields.', {
      details: { fields },
    });
  }

  return parsed.data;
};

export const toPatientProfile = (fields: ProcessDocumentFields): PatientRedactionProfile => ({
  fullName: fields.patientName,
  aliases: fields.patientNameAliases,
  ...(fields.patientDateOfBirth === undefined ? {} : { dateOfBirth: fields.patientDateOfBirth }),
  ...(fields.patientPhone === undefined ? {} : { phone: fields.patientPhone }),
  ...(fields.patientCity === undefined ? {} : { city: fields.patientCity }),
  knownPatientIds: fields.knownPatientIds,
});
