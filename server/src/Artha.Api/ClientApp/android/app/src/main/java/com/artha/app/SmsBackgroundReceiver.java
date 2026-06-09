package com.artha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Manifest-declared receiver that fires even when the app is killed. When a bank
 * SMS that looks like a debit arrives while Artha is NOT in the foreground, it
 * posts a notification; tapping it opens the app, where the catch-up scan shows
 * the confirm dialog. When the app is foregrounded the in-app live listener
 * handles the popup instead, so this receiver stands down to avoid double UX.
 */
public class SmsBackgroundReceiver extends BroadcastReceiver {

    /** SharedPreferences the JS layer writes the ignored-sender list into. */
    static final String PREFS = "artha_sms";
    static final String KEY_IGNORED = "ignored_senders";
    /** Normalised senders we have a learned account mapping for (JS-synced).
     *  When the triggering sender is in here we add a one-tap "Add" action. */
    static final String KEY_KNOWN = "known_senders";
    /** Extra set on the "Add" action's launch intent so the app logs straight away. */
    static final String EXTRA_ACTION_ADD = "artha_action_add";

    // The SMS behind the most recent notification, stashed so the app can open
    // the confirm dialog straight from it (no inbox re-scan) when tapped.
    static final String KEY_PENDING_BODY = "pending_sms_body";
    static final String KEY_PENDING_ADDRESS = "pending_sms_address";
    static final String KEY_PENDING_DATE = "pending_sms_date";
    /** Extra set on the launch intent so the app knows it was opened from the alert. */
    static final String EXTRA_OPEN_SMS = "artha_open_sms";

    private static final String CHANNEL_ID = "artha_sms";
    private static final int NOTIF_ID = 4201;

    // Lightweight mirror of the JS parser, just enough to decide whether to notify.
    private static final Pattern AMOUNT = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern DEBIT = Pattern.compile("(?i)\\b(debited|spent|withdrawn|withdrawal|purchase|paid|payment|deducted|charged|debit|sent)\\b");
    private static final Pattern CREDIT = Pattern.compile("(?i)\\b(credited|received|refund|reversal|deposited|salary|cashback)\\b");
    private static final Pattern NOISE = Pattern.compile("(?i)\\b(otp|one[\\s-]?time|do not share|verification code|is due|payment due|reward|offer)\\b");

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {
            return;
        }
        // Foreground: the in-app live listener shows the popup — don't also notify.
        if (MainActivity.isForeground) {
            return;
        }

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) {
            return;
        }
        StringBuilder sb = new StringBuilder();
        String address = "";
        for (SmsMessage part : parts) {
            if (part == null) {
                continue;
            }
            sb.append(part.getMessageBody());
            String from = part.getOriginatingAddress();
            if (from != null) {
                address = from;
            }
        }
        // Respect the user's ignored-sender list.
        if (isIgnored(context, address)) {
            return;
        }
        String body = sb.toString();
        if (body.isEmpty() || NOISE.matcher(body).find()) {
            return;
        }
        if (!DEBIT.matcher(body).find() || CREDIT.matcher(body).find()) {
            return;
        }
        Matcher amount = AMOUNT.matcher(body);
        if (!amount.find()) {
            return;
        }

        postNotification(context, amount.group(1), address, body);
    }

    private boolean isIgnored(Context ctx, String sender) {
        return inCsvPref(ctx, KEY_IGNORED, sender);
    }

    /** Whether the JS layer has told us this sender has a learned account. */
    private boolean isKnown(Context ctx, String sender) {
        return inCsvPref(ctx, KEY_KNOWN, sender);
    }

    private boolean inCsvPref(Context ctx, String key, String sender) {
        if (sender == null || sender.isEmpty()) {
            return false;
        }
        String csv = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "");
        if (csv == null || csv.isEmpty()) {
            return false;
        }
        String norm = normalizeSender(sender);
        for (String s : csv.split(",")) {
            if (!s.isEmpty() && s.equals(norm)) {
                return true;
            }
        }
        return false;
    }

    /** Must match the JS normalizeSender(): strip operator prefix, keep A-Z0-9. */
    private static String normalizeSender(String sender) {
        return sender.toUpperCase()
            .replaceFirst("^[A-Z]{1,2}-", "")
            .replaceAll("[^A-Z0-9]", "");
    }

    private void postNotification(Context context, String amount, String address, String body) {
        NotificationManager nm =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Expense detection", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Alerts when a bank SMS looks like an expense");
            nm.createNotificationChannel(channel);
        }

        // Stash the triggering SMS so a tap can open the confirm dialog straight
        // from it, without waiting on an inbox re-scan.
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PENDING_BODY, body)
            .putString(KEY_PENDING_ADDRESS, address)
            .putLong(KEY_PENDING_DATE, System.currentTimeMillis())
            .apply();

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra(EXTRA_OPEN_SMS, true);
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, launch, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle("Expense detected")
            .setContentText("₹" + amount + " — tap to review and log it in Artha")
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentIntent);

        // When this sender already has a learned account, offer a one-tap "Add"
        // action: it opens the app and logs the expense straight away (the app
        // falls back to the review dialog if the category isn't actually known).
        if (isKnown(context, address)) {
            Intent addLaunch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (addLaunch != null) {
                addLaunch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                addLaunch.putExtra(EXTRA_OPEN_SMS, true);
                addLaunch.putExtra(EXTRA_ACTION_ADD, true);
                PendingIntent addIntent = PendingIntent.getActivity(context, 1, addLaunch, flags);
                builder.addAction(0, "Add ₹" + amount, addIntent);
            }
        }

        nm.notify(NOTIF_ID, builder.build());
    }
}
