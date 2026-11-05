package com.artha.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
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
    /** JSON {normalisedSender: accountName} of learned account mappings (JS-synced). */
    static final String KEY_ACCOUNT_NAMES = "account_names";
    /** JSON {merchantKey: categoryName} of learned category mappings (JS-synced). */
    static final String KEY_CATEGORY_NAMES = "category_names";
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
    static final int NOTIF_ID = 4201;
    /** Broadcast action handled by SmsActionReceiver to dismiss the notification. */
    static final String ACTION_DISMISS = "com.artha.app.SMS_DISMISS";
    /** Broadcast action handled by SmsActionReceiver to pre-approve the expense. */
    static final String ACTION_APPROVE = "com.artha.app.SMS_APPROVE";
    static final String EXTRA_NOTIF_ID = "artha_notif_id";

    // Lightweight mirror of the JS parser, just enough to decide whether to notify.
    private static final Pattern AMOUNT = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern DEBIT = Pattern.compile("(?i)\\b(debited|spent|withdrawn|withdrawal|purchase|paid|payment|deducted|charged|debit|sent)\\b");
    private static final Pattern CREDIT = Pattern.compile("(?i)\\b(credited|received|refund|reversal|deposited|salary|cashback)\\b");
    // Keep in step with NOISE_RE in sms-parser.ts, or a notice the app would
    // ignore (e.g. an e-mandate pre-debit alert) still pops the lock-screen prompt.
    private static final Pattern NOISE = Pattern.compile("(?i)\\b(otp|one[\\s-]?time|do not share|verification code|will be (?:debited|deducted|charged)|has been blocked|requested|e-?mandate|emi due|payment due|bill of|statement|is due|reward|offer)\\b");

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
        if (sender == null || sender.isEmpty()) {
            return false;
        }
        String csv = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_IGNORED, "");
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

    /** The app's launcher icon (colored logo) as a Bitmap, for setLargeIcon. */
    private Bitmap appLogoBitmap(Context ctx) {
        try {
            Drawable d = ctx.getPackageManager().getApplicationIcon(ctx.getPackageName());
            if (d instanceof BitmapDrawable) {
                return ((BitmapDrawable) d).getBitmap();
            }
            // Adaptive/vector icons: render the drawable into a bitmap.
            int w = Math.max(1, d.getIntrinsicWidth());
            int h = Math.max(1, d.getIntrinsicHeight());
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            d.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
            d.draw(canvas);
            return bmp;
        } catch (Exception e) {
            return null;
        }
    }

    private org.json.JSONObject readJson(Context ctx, String key) {
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "");
        if (raw == null || raw.isEmpty()) {
            return new org.json.JSONObject();
        }
        try {
            return new org.json.JSONObject(raw);
        } catch (org.json.JSONException e) {
            return new org.json.JSONObject();
        }
    }

    /** Learned account name for this sender, or null. */
    private String accountNameFor(Context ctx, String sender) {
        if (sender == null || sender.isEmpty()) {
            return null;
        }
        return readJson(ctx, KEY_ACCOUNT_NAMES).optString(normalizeSender(sender), null);
    }

    /** Learned category name for this SMS: the first learned merchant key the
     *  body contains (avoids fragile merchant re-parsing). Null if none match. */
    private String categoryNameFor(Context ctx, String body) {
        org.json.JSONObject map = readJson(ctx, KEY_CATEGORY_NAMES);
        String hay = body.toLowerCase().replaceAll("[^a-z0-9]", "");
        java.util.Iterator<String> keys = map.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.isEmpty() && hay.contains(key)) {
                return map.optString(key, null);
            }
        }
        return null;
    }

    /**
     * Very rough merchant/payee hint pulled from the SMS body — only used as
     * a one-line subtitle on the lock-screen prompt. The real parser lives
     * in the web layer; this is just enough signal to make the Activity
     * useful before the WebView ever boots. Returns null when nothing
     * matches, so the UI can collapse the merchant row.
     */
    static String merchantHint(String body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        // "at <merchant>" / "to <merchant>" — stops at punctuation or " on ".
        Matcher m = Pattern.compile(
            "(?i)\\b(?:at|to|towards|for)\\s+([A-Z0-9&'\\.\\- ]{3,40}?)" +
            "(?=\\s+(?:on|dated|from|via|using|a/c|avl|bal|ref)\\b|[.,\\n]|$)"
        ).matcher(body);
        if (m.find()) {
            String hit = m.group(1).trim();
            if (!hit.isEmpty()) {
                return hit;
            }
        }
        // UPI VPA pattern — "VPA someone@bank" or "to someone@bank".
        Matcher upi = Pattern.compile("(?i)([a-z0-9._\\-]{2,})@[a-z]{2,}").matcher(body);
        if (upi.find()) {
            return upi.group(1);
        }
        return null;
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
            // IMPORTANCE_HIGH gets the heads-up banner and is the minimum
            // required for setFullScreenIntent to actually take over the lock
            // screen. (DEFAULT would silently fall back to a tray entry.)
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Expense detection", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Alerts when a bank SMS looks like an expense");
            channel.enableLights(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
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

        // Both the account (by sender) and category (a learned merchant key found
        // in the body) must resolve to offer the one-tap "Add" action.
        String accountName = accountNameFor(context, address);
        String categoryName = categoryNameFor(context, body);
        boolean canAdd = accountName != null && !accountName.isEmpty()
            && categoryName != null && !categoryName.isEmpty();

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        // Tapping the notification body opens the WebView via MainActivity.
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra(EXTRA_OPEN_SMS, true);
        }
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, launch, flags);

        // The full-screen intent, on the other hand, points at SmsPromptActivity:
        // a dedicated lock-screen takeover (MyGate / NoBroker visitor-approval
        // pattern) that renders over the keyguard and handles Approve / Dismiss
        // WITHOUT booting the WebView. Carries every extra the Activity needs
        // so the user never waits on an inbox re-scan or a web-layer boot.
        Intent prompt = new Intent(context, SmsPromptActivity.class);
        prompt.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_NO_HISTORY);
        prompt.putExtra(SmsPromptActivity.EXTRA_AMOUNT_DISPLAY, "₹" + amount);
        prompt.putExtra(SmsPromptActivity.EXTRA_MERCHANT, merchantHint(body));
        prompt.putExtra(SmsPromptActivity.EXTRA_CATEGORY, categoryName);
        prompt.putExtra(SmsPromptActivity.EXTRA_ACCOUNT, accountName);
        prompt.putExtra(SmsPromptActivity.EXTRA_BODY, body);
        prompt.putExtra(SmsPromptActivity.EXTRA_ADDRESS, address);
        prompt.putExtra(SmsPromptActivity.EXTRA_DATE, System.currentTimeMillis());
        prompt.putExtra(SmsPromptActivity.EXTRA_CAN_ADD, canAdd);
        prompt.putExtra(SmsPromptActivity.EXTRA_NOTIF_ID, NOTIF_ID);
        PendingIntent fullScreenIntent =
            PendingIntent.getActivity(context, 3, prompt, flags);

        String text = canAdd
            ? "₹" + amount + " · " + categoryName + " · " + accountName
            : "₹" + amount + " — tap to review and log it in Artha";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle("Expense detected")
            .setContentText(text)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(contentIntent)
            // Backup path to the takeover for the screen-off / locked case,
            // and the fallback when Background Activity Launch is refused
            // (some OEMs, future restrictions). The primary path is the
            // direct context.startActivity(prompt) below. On Android 14+ the
            // OS also requires USE_FULL_SCREEN_INTENT to be granted under
            // Settings → App → Full-screen notifications; the in-app Settings
            // row deep-links to that screen.
            .setFullScreenIntent(fullScreenIntent, true);

        // Show the app logo as the notification's large icon.
        Bitmap logo = appLogoBitmap(context);
        if (logo != null) {
            builder.setLargeIcon(logo);
        }

        if (canAdd) {
            // Silent Approve: fires SmsActionReceiver which enqueues the
            // pre-approved entry and cancels the notification. Does NOT open
            // the WebView — same pattern as the lock-screen Approve button.
            Intent approveIntent = new Intent(context, SmsActionReceiver.class)
                .setAction(ACTION_APPROVE)
                .putExtra(EXTRA_NOTIF_ID, NOTIF_ID)
                .putExtra(SmsPromptActivity.EXTRA_AMOUNT_DISPLAY, "₹" + amount)
                .putExtra(SmsPromptActivity.EXTRA_MERCHANT, merchantHint(body))
                .putExtra(SmsPromptActivity.EXTRA_CATEGORY, categoryName)
                .putExtra(SmsPromptActivity.EXTRA_ACCOUNT, accountName)
                .putExtra(SmsPromptActivity.EXTRA_BODY, body)
                .putExtra(SmsPromptActivity.EXTRA_ADDRESS, address)
                .putExtra(SmsPromptActivity.EXTRA_DATE, System.currentTimeMillis());
            PendingIntent approvePending =
                PendingIntent.getBroadcast(context, 1, approveIntent, flags);
            builder.addAction(0, "Add to " + categoryName, approvePending);
        }

        // Dismiss action: silent — fires SmsActionReceiver which just cancels
        // the notification without launching the app. Also acts as the swipe-
        // away deleteIntent so swipe-to-dismiss goes through the same path.
        Intent dismissIntent = new Intent(context, SmsActionReceiver.class)
            .setAction(ACTION_DISMISS)
            .putExtra(EXTRA_NOTIF_ID, NOTIF_ID);
        PendingIntent dismissPending = PendingIntent.getBroadcast(context, 2, dismissIntent, flags);
        builder.addAction(0, "Dismiss", dismissPending);
        builder.setDeleteIntent(dismissPending);

        nm.notify(NOTIF_ID, builder.build());

        // Directly launch the Activity — the MyGate / NoBroker trick.
        // setFullScreenIntent only renders as a takeover when the screen is
        // off / locked; on an unlocked phone Android downgrades it to a heads-
        // up banner. SMS_RECEIVED broadcasts, however, grant us Background
        // Activity Launch (one of the system-exempt broadcasts), so a direct
        // startActivity() pops the prompt over whatever the user was doing —
        // exactly how a visitor-approval screen behaves. The notification
        // still goes out as the shade entry / fallback.
        try {
            context.startActivity(prompt);
        } catch (Exception ignored) {
            // BAL may be refused on some OEMs or with changed restrictions —
            // the notification + its full-screen intent are the fallback.
        }
    }
}
