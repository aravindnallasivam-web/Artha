/**
 * Bank presets for SMS balance sync. `senderIds` are the normalised sender
 * short-codes a bank texts from (used to match the balance reply). The
 * `enquiryNumber` / `enquiryKeyword` are *defaults* — balance-by-SMS varies by
 * bank and region and many use missed-call instead, so the user verifies/edits
 * them (and we remember the edit) before any SMS is sent.
 */
export interface BankPreset {
  id: string;
  name: string;
  /** Normalised sender codes (uppercase, no operator prefix) for reply matching. */
  senderIds: string[];
  enquiryNumber?: string;
  enquiryKeyword?: string;
}

export const BANK_PRESETS: BankPreset[] = [
  { id: 'hdfc', name: 'HDFC Bank', senderIds: ['HDFCBK', 'HDFCB'], enquiryKeyword: 'BAL' },
  { id: 'icici', name: 'ICICI Bank', senderIds: ['ICICIB', 'ICICIT', 'ICICI'], enquiryKeyword: 'IBAL' },
  { id: 'sbi', name: 'State Bank of India', senderIds: ['SBIINB', 'SBIPSG', 'ATMSBI', 'SBICRD', 'CBSSBI'], enquiryNumber: '09223766666', enquiryKeyword: 'BAL' },
  { id: 'axis', name: 'Axis Bank', senderIds: ['AXISBK', 'AXISBANK'], enquiryKeyword: 'BAL' },
  { id: 'kotak', name: 'Kotak Mahindra Bank', senderIds: ['KOTAKB', 'KOTAK'] },
  { id: 'yes', name: 'YES Bank', senderIds: ['YESBNK', 'YESBK'] },
  { id: 'indusind', name: 'IndusInd Bank', senderIds: ['INDUSB', 'INDBNK'] },
  { id: 'pnb', name: 'Punjab National Bank', senderIds: ['PNBSMS', 'PNBBNK'], enquiryNumber: '5607040', enquiryKeyword: 'BAL' },
  { id: 'bob', name: 'Bank of Baroda', senderIds: ['BOBTXN', 'BOBSMS', 'BOBIBN'], enquiryNumber: '8468001111' },
  { id: 'canara', name: 'Canara Bank', senderIds: ['CANBNK', 'CANARA'] },
  { id: 'idfc', name: 'IDFC FIRST Bank', senderIds: ['IDFCFB', 'IDFCBK'] },
  { id: 'other', name: 'Other / not listed', senderIds: [] },
];

export function bankPresetById(id: string | null | undefined): BankPreset | null {
  if (!id) {
    return null;
  }
  return BANK_PRESETS.find((b) => b.id === id) ?? null;
}
