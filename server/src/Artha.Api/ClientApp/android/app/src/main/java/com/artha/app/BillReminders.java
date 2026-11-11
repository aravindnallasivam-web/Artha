package com.artha.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Bill reminders from SMS: credit-card statements and "due on" messages are
 * kept as bills on the phone, a daily alarm reminds before the due date, and a
 * "payment received" SMS for the same card marks the bill paid.
 *
 * Also the BroadcastReceiver for that daily alarm and for BOOT_COMPLETED
 * (alarms don't survive a reboot).
 */
public class BillReminders extends BroadcastReceiver {

    static final String ACTION_CHECK = "com.artha.app.BILL_CHECK";
    static final String KEY_BILLS = "bills";
    static final String KEY_CONFIG = "bill_config";
    static final String EXTRA_OPEN_ROUTE = "artha_open_route";
    private static final String CHANNEL_ID = "artha_bills";
    private static final int NOTIF_BASE = 4200;
    private static final int MAX_BILLS = 80;
    private static final long DAY_MS = 24L * 60 * 60 * 1000;

    // ---- Parsing ----

    private static final String AMT = "(?:rs\\.?|inr|₹)?\\s*([\\d,]+(?:\\.\\d{1,2})?)";
    private static final Pattern BILL = Pattern.compile(
        "(?i)(statement|total\\s*(?:amount|amt)?\\s*due|amount\\s*due|amt\\s*due|min(?:imum)?\\.?\\s*(?:amount|amt)?\\s*due"
            + "|payment\\s*(?:is\\s*)?due|due\\s*date|is\\s*due|due\\s*on|due\\s*by|pay\\s*by|payable\\s*by"
            + "|bill\\s*(?:of|for|amount|amt|generated|is|dated)|emi\\s*(?:of|due|is))");
    /** Promotions, OTPs and auto-debits are not bills to remind about. */
    private static final Pattern NOT_BILL = Pattern.compile(
        "(?i)\\b(otp|one[\\s-]?time|verification|offer|cashback|win|reward|discount|pre-?approved|eligible|apply now"
            + "|will be (?:debited|deducted|charged)|auto[\\s-]?debit|autopay|e-?mandate|standing instruction"
            + "|has been debited|is debited|debited from|spent)\\b");
    private static final Pattern PAID = Pattern.compile(
        "(?i)(payment\\s*(?:of|for)?[^.]{0,60}?(?:has been\\s*|is\\s*)?(?:received|credited|successful|processed|posted)"
            + "|received\\s*(?:your\\s*|a\\s*)?payment|thank\\s*you\\s*for\\s*(?:the\\s*|your\\s*)?payment)");
    private static final Pattern TOTAL_DUE = Pattern.compile(
        "(?i)(total\\s*(?:amount|amt)?\\s*(?:due|payable|outstanding)|amount\\s*(?:due|payable)|amt\\s*due"
            + "|bill\\s*(?:amount|amt)|bill\\s*of|emi\\s*(?:of|amount|amt)|outstanding)[^\\d]{0,25}?" + AMT);
    private static final Pattern MIN_DUE = Pattern.compile(
        "(?i)min(?:imum)?\\.?\\s*(?:amount|amt)?\\s*(?:due|payable)[^\\d]{0,25}?" + AMT);
    private static final Pattern MIN_WORD = Pattern.compile("(?i)\\bmin(?:imum)?\\b");
    private static final Pattern NOT_DUE_AMOUNT = Pattern.compile("(?i)(limit|lmt|bal(?:ance)?|avl|available)");
    private static final Pattern ANY_AMOUNT = Pattern.compile("(?i)(?:rs\\.?|inr|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)");
    private static final Pattern DUE_WORD = Pattern.compile("(?i)(due\\s*(?:date|on|by)?|pay(?:able)?\\s*by|before)");
    private static final Pattern LAST4 = Pattern.compile(
        "(?i)(?:card|a/c|ac|acct|account|loan)\\s*(?:no\\.?|number)?\\s*(?:ending\\s*(?:with|in)?)?\\s*[:\\-]?\\s*[x*•.]*\\s*(\\d{4})\\b");
    private static final String MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
    private static final Pattern D_NUM = Pattern.compile("\\b(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})\\b");
    private static final Pattern D_ISO = Pattern.compile("\\b(\\d{4})-(\\d{2})-(\\d{2})\\b");
    private static final Pattern D_DMON = Pattern.compile("(?i)\\b(\\d{1,2})(?:st|nd|rd|th)?[-\\s]?" + MON + "\\.?(?:[-\\s,']*(\\d{2,4}))?");
    private static final Pattern D_MOND = Pattern.compile("(?i)\\b" + MON + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?");

    /** One bill parsed from an SMS (amount in rupees; dueDate as yyyy-MM-dd). */
    static final class Parsed {
        String title;
        String kind;
        String last4;
        double amount;
        double minDue;
        String dueDate;
        long dueMs;
    }

    /** True when the bill patterns handle this SMS (a bill, or a payment received). */
    static boolean recognises(String address, String body, long smsMs) {
        return body != null && (PAID.matcher(body).find() || parse(address, body, smsMs) != null);
    }

    static Parsed parse(String address, String body, long smsMs) {
        if (body == null || body.isEmpty()) return null;
        if (!BILL.matcher(body).find() || NOT_BILL.matcher(body).find() || PAID.matcher(body).find()) return null;

        Calendar due = dueDate(body, smsMs);
        if (due == null) return null;
        long dueMs = due.getTimeInMillis();
        // A reminder needs a date ahead of the SMS (allow a day of slack), not too far out.
        if (dueMs < startOfDay(smsMs) - DAY_MS || dueMs > smsMs + 75 * DAY_MS) return null;

        double amount = totalDue(body);
        double minDue = firstAmount(MIN_DUE, body);
        if (amount <= 0) amount = minDue;
        if (amount <= 0) return null;

        Parsed p = new Parsed();
        Matcher l4 = LAST4.matcher(body);
        p.last4 = l4.find() ? l4.group(1) : "";
        String lower = body.toLowerCase(Locale.ROOT);
        p.kind = lower.contains("credit card") || lower.contains("card ending") || lower.contains(" card ")
            || lower.contains("card no") ? "card" : lower.contains("emi") || lower.contains("loan") ? "emi" : "bill";
        String biller = billerName(address);
        String what = "card".equals(p.kind) ? (biller.endsWith("Card") ? "" : "credit card")
            : "emi".equals(p.kind) ? "EMI" : "bill";
        p.title = (biller + " " + what).trim() + (p.last4.isEmpty() ? "" : " ••" + p.last4);
        p.amount = amount;
        p.minDue = minDue;
        p.dueMs = dueMs;
        p.dueDate = String.format(Locale.ROOT, "%04d-%02d-%02d",
            due.get(Calendar.YEAR), due.get(Calendar.MONTH) + 1, due.get(Calendar.DAY_OF_MONTH));
        return p;
    }

    private static double totalDue(String body) {
        Matcher m = TOTAL_DUE.matcher(body);
        while (m.find()) {
            // "Min Amt Due" also reads as "amt due": skip matches right after "min".
            String before = body.substring(Math.max(0, m.start() - 12), m.start());
            if (MIN_WORD.matcher(before).find()) continue;
            double v = num(m.group(2));
            if (v > 0) return v;
        }
        Matcher any = ANY_AMOUNT.matcher(body);
        while (any.find()) {
            String before = body.substring(Math.max(0, any.start() - 25), any.start());
            if (MIN_WORD.matcher(before).find() || NOT_DUE_AMOUNT.matcher(before).find()) continue;
            double v = num(any.group(1));
            if (v > 0) return v;
        }
        return 0;
    }

    private static double firstAmount(Pattern p, String body) {
        Matcher m = p.matcher(body);
        return m.find() ? num(m.group(1)) : 0;
    }

    private static double num(String s) {
        try {
            return Double.parseDouble(s.replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }

    /** The date right after "due" / "pay by" first; else the first date not before the SMS. */
    private static Calendar dueDate(String body, long smsMs) {
        Matcher w = DUE_WORD.matcher(body);
        while (w.find()) {
            String after = body.substring(w.end(), Math.min(body.length(), w.end() + 45));
            Calendar c = firstDate(after, smsMs);
            if (c != null) return c;
        }
        Calendar c = firstDate(body, smsMs);
        return c != null && c.getTimeInMillis() >= startOfDay(smsMs) - DAY_MS ? c : null;
    }

    private static Calendar firstDate(String s, long smsMs) {
        Calendar best = null;
        int bestAt = Integer.MAX_VALUE;
        Matcher m = D_ISO.matcher(s);
        if (m.find() && m.start() < bestAt) {
            Calendar c = make(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            if (c != null) { best = c; bestAt = m.start(); }
        }
        m = D_NUM.matcher(s);
        if (m.find() && m.start() < bestAt) {
            int y = Integer.parseInt(m.group(3));
            if (y < 100) y += 2000;
            Calendar c = make(y, Integer.parseInt(m.group(2)), Integer.parseInt(m.group(1)));
            if (c != null) { best = c; bestAt = m.start(); }
        }
        m = D_DMON.matcher(s);
        if (m.find() && m.start() < bestAt) {
            Calendar c = withYear(Integer.parseInt(m.group(1)), month(m.group(2)), m.group(3), smsMs);
            if (c != null) { best = c; bestAt = m.start(); }
        }
        m = D_MOND.matcher(s);
        if (m.find() && m.start() < bestAt) {
            Calendar c = withYear(Integer.parseInt(m.group(2)), month(m.group(1)), m.group(3), smsMs);
            if (c != null) { best = c; }
        }
        return best;
    }

    private static int month(String name) {
        String[] names = {"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"};
        String n = name.toLowerCase(Locale.ROOT).substring(0, 3);
        for (int i = 0; i < 12; i++) if (names[i].equals(n)) return i + 1;
        return 0;
    }

    /** "20 Nov" without a year: the 20 Nov nearest after the SMS (a little before counts too). */
    private static Calendar withYear(int day, int month, String yearText, long smsMs) {
        if (month == 0) return null;
        if (yearText != null && !yearText.isEmpty()) {
            int y = Integer.parseInt(yearText);
            if (y < 100) y += 2000;
            return make(y, month, day);
        }
        Calendar sms = Calendar.getInstance();
        sms.setTimeInMillis(smsMs);
        Calendar c = make(sms.get(Calendar.YEAR), month, day);
        if (c != null && c.getTimeInMillis() < startOfDay(smsMs) - 15 * DAY_MS) {
            c = make(sms.get(Calendar.YEAR) + 1, month, day);
        }
        return c;
    }

    private static Calendar make(int y, int m, int d) {
        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
        Calendar c = Calendar.getInstance();
        c.clear();
        c.setLenient(false);
        try {
            c.set(y, m - 1, d, 0, 0, 0);
            c.getTimeInMillis();
            return c;
        } catch (Exception e) {
            return null;
        }
    }

    private static long startOfDay(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /** "HDFC Bank" for AX-HDFCBK; otherwise the cleaned sender id. */
    static String billerName(String address) {
        String n = address == null ? "" : address.toUpperCase(Locale.ROOT)
            .replaceFirst("^[A-Z]{1,2}-", "").replaceAll("-[A-Z]$", "").replaceAll("[^A-Z0-9]", "");
        String[][] known = {
            {"HDFC", "HDFC Bank"}, {"ICICI", "ICICI Bank"}, {"SBICRD", "SBI Card"}, {"SBI", "SBI"},
            {"AXIS", "Axis Bank"}, {"KOTAK", "Kotak"}, {"KKBK", "Kotak"}, {"YESB", "Yes Bank"}, {"INDUS", "IndusInd"},
            {"IDFC", "IDFC First"}, {"AMEX", "Amex"}, {"RBL", "RBL Bank"}, {"SCB", "Standard Chartered"},
            {"BOB", "Bank of Baroda"}, {"CITI", "Citi"}, {"AUBANK", "AU Bank"}, {"FEDBK", "Federal Bank"},
            {"BESCOM", "BESCOM"}, {"TATAPW", "Tata Power"}, {"AIRTEL", "Airtel"}, {"JIO", "Jio"}, {"BSNL", "BSNL"},
            {"VI", "Vi"}, {"ACT", "ACT Fibernet"}, {"BAJAJ", "Bajaj Finance"}, {"BAJFIN", "Bajaj Finance"},
        };
        for (String[] k : known) {
            // Short codes must start the sender id; longer ones can sit anywhere in it.
            if (k[0].length() <= 3 ? n.startsWith(k[0]) : n.contains(k[0])) {
                return k[1];
            }
        }
        return n.isEmpty() ? "Bill" : n;
    }

    // ---- Storage ----

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject config(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString(KEY_CONFIG, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static boolean enabled(Context ctx) {
        return config(ctx).optBoolean("enabled", true);
    }

    static int daysBefore(Context ctx) {
        return Math.max(1, Math.min(10, config(ctx).optInt("daysBefore", 3)));
    }

    static synchronized JSONArray all(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_BILLS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void save(Context ctx, JSONArray bills) {
        prefs(ctx).edit().putString(KEY_BILLS, bills.toString()).apply();
    }

    private static String normSender(String address) {
        return address == null ? "" : address.toUpperCase(Locale.ROOT)
            .replaceFirst("^[A-Z]{1,2}-", "").replaceAll("[^A-Z0-9]", "");
    }

    /**
     * Handle one incoming / scanned SMS: store a new bill, or mark a bill paid.
     * True when something changed.
     */
    static synchronized boolean onSms(Context ctx, String address, String body, long smsMs) {
        if (body == null || body.isEmpty()) return false;
        if (PAID.matcher(body).find()) {
            return markPaidFrom(ctx, address, body, smsMs);
        }
        Parsed p = parse(address, body, smsMs);
        if (p == null) return false;
        return store(ctx, address, p, smsMs, false);
    }

    /** A bill the AI read from an SMS no pattern recognised (shown as "found by AI"). */
    static synchronized boolean storeFromAi(Context ctx, String address, AiClient.MessageKind k, long smsMs) {
        String[] ymd = k.dueDate.split("-");
        if (ymd.length != 3) return false;
        Calendar due;
        try {
            due = make(Integer.parseInt(ymd[0]), Integer.parseInt(ymd[1]), Integer.parseInt(ymd[2]));
        } catch (Exception e) {
            return false;
        }
        if (due == null) return false;
        long dueMs = due.getTimeInMillis();
        if (dueMs < startOfDay(smsMs) - DAY_MS || dueMs > smsMs + 75 * DAY_MS) return false;
        double amount = k.amount > 0 ? k.amount : k.minDue;
        if (amount <= 0) return false;
        Parsed p = new Parsed();
        p.last4 = k.last4.length() >= 4 ? k.last4.substring(k.last4.length() - 4) : "";
        String biller = billerName(address);
        // Unknown sender code: the AI's biller name reads better.
        if (biller.equals(normSender(address)) && !k.merchant.isEmpty()) biller = k.merchant;
        p.kind = p.last4.isEmpty() ? "bill" : "card";
        p.title = (biller + (p.last4.isEmpty() ? " bill" : biller.endsWith("Card") ? "" : " card")).trim()
            + (p.last4.isEmpty() ? "" : " \u2022\u2022" + p.last4);
        p.amount = amount;
        p.minDue = k.minDue;
        p.dueMs = dueMs;
        p.dueDate = String.format(Locale.ROOT, "%04d-%02d-%02d",
            due.get(Calendar.YEAR), due.get(Calendar.MONTH) + 1, due.get(Calendar.DAY_OF_MONTH));
        return store(ctx, address, p, smsMs, true);
    }

    private static boolean store(Context ctx, String address, Parsed p, long smsMs, boolean ai) {
        String sender = normSender(address);
        String id = sender + "|" + p.last4 + "|" + p.dueDate;
        JSONArray bills = all(ctx);
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();
        JSONObject existing = null;
        for (int i = 0; i < bills.length(); i++) {
            JSONObject b = bills.optJSONObject(i);
            if (b == null) continue;
            if (id.equals(b.optString("id"))) {
                existing = b;
            }
            // Drop bills settled or long past (60 days after the due date).
            if (b.optLong("dueMs", 0) < now - 60 * DAY_MS) continue;
            kept.put(b);
        }
        try {
            if (existing != null) {
                // A reminder SMS for the same bill: keep the newest figures and the status.
                existing.put("amount", p.amount).put("minDue", p.minDue);
                save(ctx, kept);
                return true;
            }
            JSONObject b = new JSONObject()
                .put("id", id)
                .put("sender", sender)
                .put("title", p.title)
                .put("kind", p.kind)
                .put("last4", p.last4)
                .put("amount", p.amount)
                .put("minDue", p.minDue)
                .put("dueDate", p.dueDate)
                .put("dueMs", p.dueMs)
                .put("smsDate", smsMs)
                .put("status", p.dueMs < startOfDay(now) - 7 * DAY_MS ? "paid" : "due")
                .put("notified", "")
                .put("ai", ai);
            kept.put(b);
            while (kept.length() > MAX_BILLS) kept.remove(0);
            save(ctx, kept);
        } catch (Exception e) {
            return false;
        }
        return true;
    }

    /** "Payment of Rs X received" for the same card (or the only open bill from that sender). */
    private static boolean markPaidFrom(Context ctx, String address, String body, long smsMs) {
        Matcher l4 = LAST4.matcher(body);
        return markPaid(ctx, address, l4.find() ? l4.group(1) : "", smsMs);
    }

    /** Settle the open bill for this card (or the only open one from this sender). */
    static synchronized boolean markPaid(Context ctx, String address, String last4In, long smsMs) {
        String last4 = last4In == null ? "" : last4In.length() > 4 ? last4In.substring(last4In.length() - 4) : last4In;
        String sender = normSender(address);
        JSONArray bills = all(ctx);
        JSONObject match = null;
        int sameSender = 0;
        JSONObject senderMatch = null;
        for (int i = 0; i < bills.length(); i++) {
            JSONObject b = bills.optJSONObject(i);
            if (b == null || !"due".equals(b.optString("status"))) continue;
            // A payment can't settle a bill that arrived after it.
            if (b.optLong("smsDate", 0) > smsMs) continue;
            if (!last4.isEmpty() && last4.equals(b.optString("last4"))) {
                if (match == null || b.optLong("dueMs") < match.optLong("dueMs")) match = b;
            } else if (sameSenderish(sender, b.optString("sender"))) {
                sameSender++;
                senderMatch = b;
            }
        }
        if (match == null && last4.isEmpty() && sameSender == 1) match = senderMatch;
        if (match == null) return false;
        try {
            match.put("status", "paid").put("paidAt", smsMs).put("paidBy", "sms");
        } catch (Exception e) {
            return false;
        }
        save(ctx, bills);
        return true;
    }

    /** "HDFCBK" vs "HDFCBN": same bank when the first four letters agree. */
    private static boolean sameSenderish(String a, String b) {
        if (a == null || b == null || a.length() < 4 || b.length() < 4) return false;
        return a.substring(0, 4).equals(b.substring(0, 4));
    }

    static synchronized boolean setStatus(Context ctx, String id, String status) {
        JSONArray bills = all(ctx);
        for (int i = 0; i < bills.length(); i++) {
            JSONObject b = bills.optJSONObject(i);
            if (b != null && id.equals(b.optString("id"))) {
                try {
                    b.put("status", status);
                    if ("paid".equals(status)) b.put("paidAt", System.currentTimeMillis()).put("paidBy", "user");
                    else b.remove("paidAt");
                } catch (Exception ignored) {
                    return false;
                }
                save(ctx, bills);
                cancel(ctx, id);
                return true;
            }
        }
        return false;
    }

    /** Read the inbox from `sinceMs` and pick up bills already received. Returns how many changed. */
    static int scanInbox(Context ctx, long sinceMs) {
        int changed = 0;
        try (Cursor c = ctx.getContentResolver().query(Uri.parse("content://sms/inbox"),
            new String[]{"address", "body", "date"}, "date >= ?", new String[]{String.valueOf(sinceMs)}, "date ASC")) {
            if (c == null) return 0;
            while (c.moveToNext()) {
                if (onSms(ctx, c.getString(0), c.getString(1), c.getLong(2))) changed++;
            }
        } catch (Exception ignored) {
            // No SMS permission: nothing to scan.
        }
        return changed;
    }

    // ---- Reminders ----

    /** Daily check at about 9 am (inexact, so it costs no battery). */
    static void schedule(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(ctx);
        if (!enabled(ctx)) {
            am.cancel(pi);
            return;
        }
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, 9);
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_MONTH, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    private static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, BillReminders.class).setAction(ACTION_CHECK);
        return PendingIntent.getBroadcast(ctx, 7301, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.MY_PACKAGE_REPLACED".equals(action)) {
            schedule(context);
            return;
        }
        if (ACTION_CHECK.equals(action)) {
            check(context);
        }
    }

    /** Post the reminders that are due today (each stage once per bill). */
    static synchronized void check(Context ctx) {
        if (!enabled(ctx)) return;
        int before = daysBefore(ctx);
        long today = startOfDay(System.currentTimeMillis());
        JSONArray bills = all(ctx);
        boolean changed = false;
        for (int i = 0; i < bills.length(); i++) {
            JSONObject b = bills.optJSONObject(i);
            if (b == null || !"due".equals(b.optString("status"))) continue;
            long days = Math.round((b.optLong("dueMs") - today) / (double) DAY_MS);
            String stage = days < -3 ? null : days < 0 ? "overdue" : days == 0 ? "today" : days == 1 ? "tomorrow"
                : days <= before ? "soon" : null;
            if (stage == null) continue;
            String notified = b.optString("notified", "");
            if (notified.contains(stage)) continue;
            notify(ctx, b, days);
            try {
                b.put("notified", notified + "," + stage);
            } catch (Exception ignored) { }
            changed = true;
        }
        if (changed) save(ctx, bills);
    }

    private static void notify(Context ctx, JSONObject b, long days) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Bill reminders", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Credit card and bill due dates found in your SMS");
            nm.createNotificationChannel(ch);
        }
        String when = days < 0 ? "was due " + (-days) + (days == -1 ? " day ago" : " days ago")
            : days == 0 ? "is due today" : days == 1 ? "is due tomorrow" : "is due in " + days + " days";
        String amount = rupees(b.optDouble("amount"));
        String title = b.optString("title") + " " + when;
        String text = amount + " due on " + pretty(b.optString("dueDate"))
            + (b.optDouble("minDue", 0) > 0 ? " · minimum " + rupees(b.optDouble("minDue")) : "");

        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_OPEN_ROUTE, "/bills");
        PendingIntent pi = PendingIntent.getActivity(ctx, notifId(b.optString("id")), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder nb = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(pi);
        try {
            nm.notify(notifId(b.optString("id")), nb.build());
        } catch (SecurityException ignored) {
            // Notifications not allowed.
        }
    }

    private static void cancel(Context ctx, String id) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(notifId(id));
    }

    private static int notifId(String id) {
        return NOTIF_BASE + Math.abs(id.hashCode() % 10000);
    }

    private static String rupees(double v) {
        java.text.NumberFormat f = java.text.NumberFormat.getNumberInstance(new Locale("en", "IN"));
        f.setMaximumFractionDigits(v % 1 == 0 ? 0 : 2);
        return "₹" + f.format(v);
    }

    private static String pretty(String ymd) {
        try {
            String[] p = ymd.split("-");
            String[] m = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
            return Integer.parseInt(p[2]) + " " + m[Integer.parseInt(p[1]) - 1];
        } catch (Exception e) {
            return ymd;
        }
    }
}
