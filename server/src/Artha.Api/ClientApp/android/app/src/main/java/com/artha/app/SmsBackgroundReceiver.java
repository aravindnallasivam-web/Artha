package com.artha.app;

import android.app.KeyguardManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
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
    /** JSON {last digits: accountName}: linked cards / learned a/c endings (JS-synced). */
    static final String KEY_ACCOUNT_HINTS = "account_hints";
    /** "card XX4444", "A/c no. ...5678", "card ending 4444". */
    private static final Pattern ACCOUNT_DIGITS =
        Pattern.compile("(?i)\\b(?:a/c|acct|account|card)\\b[^\\d]{0,14}(\\d{3,4})\\b");
    /** JSON {merchantKey: categoryName} of learned category mappings (JS-synced). */
    static final String KEY_CATEGORY_NAMES = "category_names";
    /** All active categories, [{name, color}], so the prompt can offer a picker. */
    static final String KEY_CATEGORY_LIST = "category_list";
    /** All active account names, [name], for the prompt's account picker. */
    static final String KEY_ACCOUNT_LIST = "account_list";
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
        String body = sb.toString();
        // Bill reminders: statements / "due on" SMS become bills, "payment received" settles them.
        // Runs even while Artha is open (there's no in-app equivalent).
        if (BillReminders.enabled(context) && BillReminders.onSms(context, address, body, System.currentTimeMillis())) {
            BillReminders.schedule(context);
            BillReminders.check(context);
        }
        // Respect the user's ignored-sender list.
        if (isIgnored(context, address)) {
            return;
        }
        // Patterns first. Only when none recognises a money-looking SMS is the AI asked.
        boolean noise = body.isEmpty() || NOISE.matcher(body).find();
        boolean hasAmount = AMOUNT.matcher(body).find();
        boolean knownExpense = !noise && hasAmount && DEBIT.matcher(body).find() && !CREDIT.matcher(body).find();
        boolean knownCredit = !noise && hasAmount && CREDIT.matcher(body).find();
        if (!knownExpense && !knownCredit && !BillReminders.recognises(address, body, System.currentTimeMillis())
            && SmsAiFallback.candidate(context, address, body)) {
            askAi(context, address, body);
            return;
        }
        // Paid with Artha's Scan & Pay moments ago: already recorded, no second prompt.
        if (knownExpense) {
            Matcher paid = AMOUNT.matcher(body);
            if (paid.find() && UpiRecent.consume(context, UpiRecent.parseAmount(paid.group(1)), body)) {
                return;
            }
        }
        // Foreground: the in-app live listener shows the popup — don't also notify.
        if (MainActivity.isForeground) {
            return;
        }
        if (noise) {
            return;
        }
        if (!DEBIT.matcher(body).find() || CREDIT.matcher(body).find()) {
            return;
        }
        Matcher amount = AMOUNT.matcher(body);
        if (!amount.find()) {
            return;
        }

        // Keep the receiver alive while the prompt is launched (see launchPrompt).
        pendingResult = goAsync();
        postNotification(context, amount.group(1), address, body);
    }

    /** Set in onReceive so launchPrompt can finish the broadcast once it's done. */
    private PendingResult pendingResult;
    /** Merchant the AI read, used on the alert instead of the pattern's guess. */
    private String merchantOverride;

    /**
     * Ask the AI what an unrecognised SMS is, off the main thread. An expense
     * pops the usual alert (the user still confirms it); bills and payments
     * are stored by SmsAiFallback; anything else is left alone.
     */
    private void askAi(Context context, String address, String body) {
        final PendingResult async = goAsync();
        final Context app = context.getApplicationContext();
        final long now = System.currentTimeMillis();
        new Thread(() -> {
            SmsAiFallback.Outcome o = SmsAiFallback.run(app, address, body, now);
            boolean expense = "expense".equals(o.action);
            if (expense || "income".equals(o.action)) {
                // The app puts it in Pending (or shows it now, when it's open).
                SmsReaderPlugin.notifyAiFound();
            }
            if (expense && !MainActivity.isForeground) {
                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    pendingResult = async;
                    merchantOverride = o.kind.merchant.isEmpty() ? null : o.kind.merchant;
                    postNotification(app, SmsAiFallback.amountText(o.kind.amount), address, body);
                });
            } else {
                async.finish();
            }
        }, "artha-sms-ai").start();
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
    private String accountNameFor(Context ctx, String sender, String body) {
        // The card / account the SMS names first: tells two cards of one bank apart.
        if (body != null) {
            org.json.JSONObject hints = readJson(ctx, KEY_ACCOUNT_HINTS);
            Matcher m = ACCOUNT_DIGITS.matcher(body);
            while (m.find()) {
                String digits = m.group(1);
                String byHint = hints.optString(digits, null);
                if (byHint == null && digits.length() == 3) {
                    // "XX444" style masks: match the end of a 4-digit ending.
                    java.util.Iterator<String> keys = hints.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        if (k.endsWith(digits)) {
                            byHint = hints.optString(k, null);
                            break;
                        }
                    }
                }
                if (byHint != null && !byHint.isEmpty()) return byHint;
            }
        }
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

    /** JSON array stored under `key`, or an empty array. */
    static org.json.JSONArray readArray(Context ctx, String key) {
        String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, "[]");
        try {
            return new org.json.JSONArray(raw == null || raw.isEmpty() ? "[]" : raw);
        } catch (org.json.JSONException e) {
            return new org.json.JSONArray();
        }
    }

    /** First real account for the test prompt, so the picker test is realistic. */
    private static String testAccount(Context ctx) {
        org.json.JSONArray accounts = readArray(ctx, KEY_ACCOUNT_LIST);
        String first = accounts.length() > 0 ? accounts.optString(0, "") : "";
        return first.isEmpty() ? "HDFC Credit Card" : first;
    }

    /** Sample SMS used by the in-app "Test lock-screen alert" button. */
    static final String TEST_ADDRESS = "AD-HDFCBK";
    static final String TEST_BODY =
        "Rs.432.00 spent on HDFC Bank Card XX1234 at BLUE TOKAI COFFEE on 09-11-26. Not you? Call 18002586161";

    /**
     * Post the sample expense prompt exactly like a real SMS would (notification +
     * full-screen intent + direct launch), but flagged as a test so Approve/Dismiss
     * never touch the pre-approved queue or the pending-SMS stash.
     */
    static void showTestPrompt(Context context) {
        new SmsBackgroundReceiver().postNotification(context, "432", TEST_ADDRESS, TEST_BODY, true);
    }

    private void postNotification(Context context, String amount, String address, String body) {
        postNotification(context, amount, address, body, false);
    }

    void postNotification(Context context, String amount, String address, String body, boolean test) {
        final String merchant = merchantOverride != null ? merchantOverride : merchantHint(body);
        NotificationManager nm =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            if (pendingResult != null) {
                pendingResult.finish();
                pendingResult = null;
            }
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
        // from it, without waiting on an inbox re-scan. (Not for the test prompt.)
        if (!test) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PENDING_BODY, body)
                .putString(KEY_PENDING_ADDRESS, address)
                .putLong(KEY_PENDING_DATE, System.currentTimeMillis())
                .apply();
        }

        // Both the account (by sender) and category (a learned merchant key found
        // in the body) must resolve to offer the one-tap "Add" action.
        String accountName = test ? testAccount(context) : accountNameFor(context, address, body);
        // The test leaves the category unknown (when the app has synced its
        // list) so the prompt shows the category picker.
        String categoryName = test
            ? (readArray(context, KEY_CATEGORY_LIST).length() > 0 ? null : "Food & Dining")
            : categoryNameFor(context, body);
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
            launch.putExtra(EXTRA_OPEN_SMS, !test);
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
        prompt.putExtra(SmsPromptActivity.EXTRA_MERCHANT, merchant);
        prompt.putExtra(SmsPromptActivity.EXTRA_CATEGORY, categoryName);
        prompt.putExtra(SmsPromptActivity.EXTRA_ACCOUNT, accountName);
        prompt.putExtra(SmsPromptActivity.EXTRA_BODY, body);
        prompt.putExtra(SmsPromptActivity.EXTRA_ADDRESS, address);
        prompt.putExtra(SmsPromptActivity.EXTRA_DATE, System.currentTimeMillis());
        prompt.putExtra(SmsPromptActivity.EXTRA_CAN_ADD, canAdd);
        prompt.putExtra(SmsPromptActivity.EXTRA_NOTIF_ID, NOTIF_ID);
        prompt.putExtra(SmsPromptActivity.EXTRA_TEST, test);
        PendingIntent fullScreenIntent =
            PendingIntent.getActivity(context, 3, prompt, flags);

        // Queue it for the full-screen prompt, which walks through every SMS
        // that arrives while it's up ("1 of 3").
        try {
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put(PromptQueue.F_AMOUNT, "₹" + amount);
            entry.put(PromptQueue.F_MERCHANT, merchant != null ? merchant : "");
            entry.put(PromptQueue.F_CATEGORY, categoryName != null ? categoryName : "");
            entry.put(PromptQueue.F_ACCOUNT, accountName != null ? accountName : "");
            entry.put(PromptQueue.F_BODY, body);
            entry.put(PromptQueue.F_ADDRESS, address);
            entry.put(PromptQueue.F_DATE, System.currentTimeMillis());
            entry.put(PromptQueue.F_TEST, test);
            if (!PromptQueue.add(context, entry)) {
                // Already waiting, or handled moments ago (Android can deliver the
                // same SMS twice): no second notification or prompt.
                if (pendingResult != null) {
                    pendingResult.finish();
                    pendingResult = null;
                }
                return;
            }
        } catch (org.json.JSONException ignored) {
            // The prompt falls back to the intent extras.
        }
        int waiting = Math.max(1, PromptQueue.size(context));

        String latest = canAdd
            ? "₹" + amount + " · " + categoryName + " · " + accountName
            : "₹" + amount + " — tap to review and log it in Artha";
        String text = waiting > 1 ? "Latest: ₹" + amount + " · tap to go through them" : latest;
        String title = waiting > 1 ? waiting + " expenses detected"
            : merchantOverride != null ? "Expense detected \u00b7 read by AI" : "Expense detected";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(test ? title + " (test)" : title)
            .setContentText(text)
            .setNumber(waiting)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(waiting > 1 ? fullScreenIntent : contentIntent)
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

        // One-tap Add from the shade only when this is the only SMS waiting;
        // with several, the prompt walks through them.
        if (canAdd && waiting == 1) {
            // Silent Approve: fires SmsActionReceiver which enqueues the
            // pre-approved entry and cancels the notification. Does NOT open
            // the WebView — same pattern as the lock-screen Approve button.
            Intent approveIntent = new Intent(context, SmsActionReceiver.class)
                .setAction(ACTION_APPROVE)
                .putExtra(EXTRA_NOTIF_ID, NOTIF_ID)
                .putExtra(SmsPromptActivity.EXTRA_AMOUNT_DISPLAY, "₹" + amount)
                .putExtra(SmsPromptActivity.EXTRA_MERCHANT, merchant)
                .putExtra(SmsPromptActivity.EXTRA_CATEGORY, categoryName)
                .putExtra(SmsPromptActivity.EXTRA_ACCOUNT, accountName)
                .putExtra(SmsPromptActivity.EXTRA_BODY, body)
                .putExtra(SmsPromptActivity.EXTRA_ADDRESS, address)
                .putExtra(SmsPromptActivity.EXTRA_DATE, System.currentTimeMillis())
                .putExtra(SmsPromptActivity.EXTRA_TEST, test);
            PendingIntent approvePending =
                PendingIntent.getBroadcast(context, 1, approveIntent, flags);
            builder.addAction(0, "Add to " + categoryName, approvePending);
        }

        // Dismiss action: silent — fires SmsActionReceiver which just cancels
        // the notification without launching the app. Also acts as the swipe-
        // away deleteIntent so swipe-to-dismiss goes through the same path.
        Intent dismissIntent = new Intent(context, SmsActionReceiver.class)
            .setAction(ACTION_DISMISS)
            .putExtra(EXTRA_NOTIF_ID, NOTIF_ID)
            .putExtra(SmsPromptActivity.EXTRA_TEST, test);
        PendingIntent dismissPending = PendingIntent.getBroadcast(context, 2, dismissIntent, flags);
        builder.addAction(0, waiting > 1 ? "Dismiss all" : "Dismiss", dismissPending);
        builder.setDeleteIntent(dismissPending);

        nm.notify(NOTIF_ID, builder.build());

        // Also launch the prompt directly so it pops over whatever is on screen
        // (the full-screen intent alone only takes over a locked / off screen).
        PendingResult pending = pendingResult;
        pendingResult = null;
        launchPrompt(context.getApplicationContext(), prompt, pending);
    }

    /**
     * Open the prompt Activity from the background. Android blocks background
     * activity starts; on Android 15+ "Display over other apps" only exempts an
     * app while one of its overlay windows is actually visible. So when the
     * phone is unlocked and the permission is granted, show an invisible 1 px
     * overlay, start the prompt once it's on screen, then remove it. Locked or
     * screen off: the notification's full-screen intent does the takeover.
     */
    static void launchPrompt(Context ctx, Intent prompt, PendingResult pending) {
        KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean locked = km != null && km.isKeyguardLocked();
        boolean screenOn = pm == null || pm.isInteractive();
        boolean canOverlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || android.provider.Settings.canDrawOverlays(ctx);
        WindowManager wm = (WindowManager) ctx.getSystemService(Context.WINDOW_SERVICE);
        if (locked || !screenOn) {
            // The notification's full-screen intent takes over a locked / dark
            // screen. Starting it ourselves as well launched the prompt twice,
            // so only do that when full-screen intents aren't allowed.
            if (!canUseFullScreenIntent(ctx)) {
                startQuietly(ctx, prompt);
            }
            if (pending != null) pending.finish();
            return;
        }
        if (!canOverlay || wm == null) {
            startQuietly(ctx, prompt);
            if (pending != null) pending.finish();
            return;
        }

        View anchor = new View(ctx);
        anchor.setBackgroundColor(Color.argb(1, 0, 0, 0));
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
            1, 1,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        try {
            wm.addView(anchor, lp);
        } catch (Exception e) {
            startQuietly(ctx, prompt);
            if (pending != null) pending.finish();
            return;
        }
        Handler h = new Handler(Looper.getMainLooper());
        // Give the overlay a moment to be drawn: the exemption counts only once it's visible.
        h.postDelayed(() -> {
            startQuietly(ctx, prompt);
            h.postDelayed(() -> {
                try {
                    wm.removeView(anchor);
                } catch (Exception ignored) {
                    // Already gone.
                }
                if (pending != null) pending.finish();
            }, 1500);
        }, 400);
    }

    private static boolean canUseFullScreenIntent(Context ctx) {
        if (Build.VERSION.SDK_INT < 34) return true;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.canUseFullScreenIntent();
    }

    private static void startQuietly(Context ctx, Intent prompt) {
        try {
            ctx.startActivity(prompt);
        } catch (Exception ignored) {
            // Refused: the notification + its full-screen intent are the fallback.
        }
    }
}
