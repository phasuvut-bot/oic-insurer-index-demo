// Policyholder verification. Pure functions plus SHA-256 via Web Crypto
// (available in browsers on localhost/https and in Node 24 as globalThis.crypto).
//
// PROTOTYPE ONLY: the salt is public and the check runs in the browser. In production the
// check runs server-side (or at the OIC / insurer) and returns only "match / no match".

export const DEMO_SALT = 'OIC-TRUST-DEMO-v1';
export const EXPIRY_GRACE_DAYS = 365;

/** Keep digits only: "1-2345-67890-12-3" -> "1234567890123". */
export const normalizeId = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Thai national ID check digit: for the first 12 digits d1..d12,
 * sum = sum(d_i * (14 - i)); check = (11 - sum mod 11) mod 10.
 */
export function thaiIdCheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
  return (11 - (sum % 11)) % 10;
}

export function isValidThaiId(raw) {
  const id = normalizeId(raw);
  return /^\d{13}$/.test(id) && thaiIdCheckDigit(id.slice(0, 12)) === Number(id[12]);
}

/** Plate text without spaces, dots or dashes, NFC-normalised: "1กข 1234" -> "1กข1234". */
export const normalizePlate = (s) => String(s ?? '').normalize('NFC').replace(/[\s.\-]/g, '').toUpperCase();

export const normalizePolicyNo = (s) => String(s ?? '').trim().toUpperCase().replace(/\s/g, '');

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash used for both the stored database and the user's input. */
export const hashField = (kind, normalisedValue, salt = DEMO_SALT) => sha256Hex(`${salt}|${kind}|${normalisedValue}`);

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Check one claim of policy ownership.
 * @param input   { policyNo, plate, province, nationalId }
 * @param policies Map policy_no -> { policy_no, insurer, plate_hash, province, id_hash, start, end, cls }
 * @param reviewed Set of policy numbers already reviewed
 * @param today   ISO date (Asia/Bangkok)
 * @returns {{ ok: boolean, reason: string|null, policy?: object }}
 */
export async function verifyPolicy(input, policies, reviewed, today) {
  if (!isValidThaiId(input.nationalId)) return { ok: false, reason: 'id_format' };
  const policy = policies.get(normalizePolicyNo(input.policyNo));
  if (!policy) return { ok: false, reason: 'not_found' };
  const plateHash = await hashField('plate', normalizePlate(input.plate));
  if (plateHash !== policy.plate_hash || input.province !== policy.province) return { ok: false, reason: 'plate_mismatch' };
  const idHash = await hashField('id', normalizeId(input.nationalId));
  if (idHash !== policy.id_hash) return { ok: false, reason: 'id_mismatch' };
  if (daysBetween(policy.end, today) > EXPIRY_GRACE_DAYS) return { ok: false, reason: 'expired' };
  if (policy.start > today) return { ok: false, reason: 'not_started' };
  if (reviewed.has(policy.policy_no)) return { ok: false, reason: 'already_reviewed' };
  return { ok: true, reason: null, policy };
}
