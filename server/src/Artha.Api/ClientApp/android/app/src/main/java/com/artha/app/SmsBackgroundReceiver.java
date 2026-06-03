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
        for (SmsMessage part : parts) {
            if (part != null) {
                sb.append(part.getMessageBody());
            }
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

        postNotification(context, amount.group(1));
    }

    private void postNotification(Context context, String amount) {
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

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
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

        nm.notify(NOTIF_ID, builder.build());
    }
}
