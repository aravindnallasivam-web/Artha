import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { ConflictNotifierService } from '../../core/feedback/conflict-notifier.service';
import { Account } from '../../core/models/account.model';
import { bankPresetById } from '../../core/models/bank-preset';
import { SmsReader } from '../../core/native/sms-reader';
import { extractBalance } from '../sms/sms-parser';
import { AccountsStore } from './accounts.store';
import { BalanceSyncModal } from './balance-sync.modal';

interface EnquiryOverride {
  number: string;
  message: string;
}

const OVERRIDE_PREFIX = 'artha.banksync.';
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 90000;

/**
 * "Sync balance" for an account: confirm/edit the bank's balance-enquiry SMS,
 * send it, then watch the inbox for the reply and update the account balance
 * automatically. Android only.
 */
@Injectable({ providedIn: 'root' })
export class BalanceSyncService {
  private readonly modalCtrl = inject(ModalController);
  private readonly accountsStore = inject(AccountsStore);
  private readonly notifier = inject(ConflictNotifierService);

  isSupported(): boolean {
    return Capacitor.getPlatform() === 'android';
  }

  async syncBalance(account: Account): Promise<void> {
    if (!this.isSupported()) {
      await this.notifier.notifyError('Balance sync works on Android only.');
      return;
    }

    const preset = bankPresetById(account.bank);
    const override = this.loadOverride(account.id);
    const to = override?.number ?? preset?.enquiryNumber ?? '';
    const message = override?.message ?? preset?.enquiryKeyword ?? '';

    const modal = await this.modalCtrl.create({
      component: BalanceSyncModal,
      componentProps: { bankName: preset?.name ?? account.name, to, message },
    });
    await modal.present();
    const { role, data } = await modal.onWillDismiss<{ to: string; message: string }>();
    if (role !== 'send' || !data) {
      return;
    }
    this.saveOverride(account.id, { number: data.to, message: data.message });

    // We need SEND_SMS to send the enquiry *and* READ_SMS to read the bank's
    // reply. Request both up front — without read access we can send but never
    // see the reply, so the balance would silently never update.
    let status = await SmsReader.checkPermissions().catch(() => null);
    if (status?.send !== 'granted' || status?.sms !== 'granted') {
      status = await SmsReader.requestPermissions().catch(() => null);
    }
    if (status?.send !== 'granted') {
      await this.notifier.notifyError('SMS send permission denied.');
      return;
    }

    const sentAt = Date.now();
    try {
      await SmsReader.sendSms({ to: data.to, body: data.message });
    } catch {
      await this.notifier.notifyError('Could not send the balance SMS.');
      return;
    }

    if (status?.sms !== 'granted') {
      await this.notifier.notifyInfo(
        'Enquiry sent. Allow SMS read access so Artha can read the reply and update the balance.',
      );
      return;
    }
    await this.notifier.notifyInfo('Balance enquiry sent — waiting for the reply…');

    const senders = (preset?.senderIds ?? []).map((s) => normalizeSender(s));
    const balance = await this.pollForBalance(sentAt - 3000, senders);
    if (balance != null) {
      await this.applyBalance(account, balance);
      await this.notifier.notifyInfo(`Balance synced: ${balance.toLocaleString()}.`);
    } else {
      await this.notifier.notifyInfo('Sent. The balance will update when the bank replies.');
    }
  }

  private async pollForBalance(since: number, senders: string[]): Promise<number | null> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(POLL_INTERVAL_MS);
      let messages;
      try {
        messages = (await SmsReader.readInbox({ since, limit: 40 })).messages;
      } catch {
        continue;
      }
      for (const m of messages) {
        if (m.date < since) {
          continue;
        }
        // Match the reply sender loosely: DLT routing wraps the bank's id with
        // prefixes/suffixes (e.g. "VM-HDFCBK-S" -> "HDFCBKS"), so accept any id
        // that contains, or is contained by, a known sender id for the bank.
        if (senders.length > 0) {
          const norm = normalizeSender(m.address);
          const matches = senders.some((id) => norm.includes(id) || id.includes(norm));
          if (!matches) {
            continue;
          }
        }
        const balance = extractBalance(m.body);
        if (balance != null) {
          return balance;
        }
      }
    }
    return null;
  }

  private async applyBalance(account: Account, balance: number): Promise<void> {
    if (Math.abs(account.openingBalance - balance) < 0.005) {
      return;
    }
    await this.accountsStore.update(account.id, {
      name: account.name,
      type: account.type,
      currency: account.currency,
      openingBalance: balance,
      color: account.color,
      icon: account.icon,
      bank: account.bank,
    });
  }

  private loadOverride(accountId: string): EnquiryOverride | null {
    try {
      const raw = localStorage.getItem(OVERRIDE_PREFIX + accountId);
      return raw ? (JSON.parse(raw) as EnquiryOverride) : null;
    } catch {
      return null;
    }
  }

  private saveOverride(accountId: string, override: EnquiryOverride): void {
    localStorage.setItem(OVERRIDE_PREFIX + accountId, JSON.stringify(override));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSender(sender: string): string {
  return (sender || '')
    .toUpperCase()
    .replace(/^[A-Z]{1,2}-/, '')
    .replace(/[^A-Z0-9]/g, '');
}
