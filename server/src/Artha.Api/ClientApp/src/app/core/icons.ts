import { addIcons } from 'ionicons';
import {
  add,
  addCircle,
  cardOutline,
  chevronForward,
  closeOutline,
  ellipsisHorizontal,
  homeOutline,
  logOutOutline,
  pencil,
  pricetag,
  receiptOutline,
  saveOutline,
  settingsOutline,
  statsChartOutline,
  trash,
  walletOutline,
} from 'ionicons/icons';

export function registerIcons(): void {
  addIcons({
    add,
    'add-circle': addCircle,
    'card-outline': cardOutline,
    'chevron-forward': chevronForward,
    'close-outline': closeOutline,
    'ellipsis-horizontal': ellipsisHorizontal,
    'home-outline': homeOutline,
    'log-out-outline': logOutOutline,
    pencil,
    pricetag,
    'receipt-outline': receiptOutline,
    'save-outline': saveOutline,
    'settings-outline': settingsOutline,
    'stats-chart-outline': statsChartOutline,
    trash,
    'wallet-outline': walletOutline,
  });
}
