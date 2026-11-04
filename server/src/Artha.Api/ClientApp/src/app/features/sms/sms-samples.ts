/**
 * Realistic bank SMS used by "Try on sample SMS" in the AI provider screen, so
 * the AI flow can be checked without waiting for a real transaction. Merchants
 * are ones a user is unlikely to have taught Artha yet, so the AI is asked.
 */
export const SAMPLE_BANK_SMS: { address: string; body: string }[] = [
  {
    address: 'VM-HDFCBK',
    body: 'Rs.432.00 debited from A/c XX4821 on {date} to VPA bluetokaicoffee@okaxis (UPI Ref No 431289765432). Not you? Call 18002586161 -HDFC Bank',
  },
  {
    address: 'AX-ICICIB',
    body: 'INR 1,249.00 spent on ICICI Bank Card XX7712 on {date} at DECATHLON SPORTS INDIA. Avl Limit: INR 1,12,430.50. To dispute, call 18001080.',
  },
  {
    address: 'BZ-SBIUPI',
    body: 'Dear Customer, Rs 2,150.00 debited from your a/c no. XX0934 on {date} for APOLLO PHARMACY (UPI:430987612345). -SBI',
  },
  {
    address: 'JM-AXISBK',
    body: 'Your A/c XX5521 is debited with Rs.799.00 on {date} towards NETFLIX ENTERTAINMENT SERVICES. Avl Bal Rs.84,120.33 -Axis Bank',
  },
  {
    address: 'VM-HDFCBK',
    body: 'Rs.186.00 paid to RAPIDO BIKE TAXI via UPI from A/c XX4821 on {date}. UPI Ref 431290001122 -HDFC Bank',
  },
  {
    address: 'VK-KOTAKB',
    body: 'INR 3,640.00 debited from Kotak Bank A/c X3302 on {date} to IRCTC ECATERING. UPI Ref:431299876543',
  },
];
