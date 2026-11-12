package com.artha.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * AI fallback for SMS the patterns don't recognise. Only a message that looks
 * like it's about money is sent (a bank / business sender, an amount or a due
 * date, no OTP or promotion), each one once, at most DAILY_CAP a day, and only
 * when the user turned on "Use AI for unrecognised SMS".
 *
 * Expenses (and income / refunds) found this way are kept in AI_FOUND for the
 * app to put in Pending as "AI guess"; bills go to BillReminders marked as AI.
 */
final class SmsAiFallback {

    static final String KEY_AI_FOUND = "ai_found";
    private static final String KEY_CHECKED = "ai_checked";
    private static final String KEY_DAILY = "ai_daily";
    static final int DAILY_CAP = 30;
    private static final long CHECKED_TTL_MS = 30L * 24 * 60 * 60 * 1000;
    private static final int FOUND_MAX = 50;

    /** Something about money: an amount with a currency, or a due date. */
    private static final Pattern MONEY = Pattern.compile(
        "(?i)((?:rs\\.?|inr|₹|usd|\\$)\\s*[\\d,]+|[\\d,]+(?:\\.\\d{1,2})?\\s*(?:rs|inr)\\b|\\bdue\\b|\\bdebited\\b|\\bcredited\\b)");
    /** Never sent: codes, marketing, and messages where a guess could do harm. */
    private static final Pattern SKIP = Pattern.compile(
        "(?i)\\b(otp|one[\\s-]?time|verification|passcode|do not share|never share|offer|cashback|win|won|reward|"
            + "discount|coupon|pre-?approved|eligible|apply now|loan upto|limit increase|congratulations|sale|voucher)\\b");

    private SmsAiFallback() {}

    /** Business sender ids look like "AX-HDFCBK" / "HDFCBK"; a phone number is a person. */
    static boolean businessSender(String address) {
        if (address == null) return false;
        String a = address.trim();
        if (!a.matches(".*[A-Za-z].*")) return false;
        return a.replaceAll("[^0-9]", "").length() < 10;
    }

    /** Worth asking the AI about (the patterns already said no). */
    static boolean candidate(Context ctx, String address, String body) {
        if (body == null || body.length() < 20 || body.length() > 1200) return false;
        if (!AiClient.smsFallbackEnabled(ctx) || !businessSender(address)) return false;
        if (!MONEY.matcher(body).find() || SKIP.matcher(body).find()) return false;
        return !checkedRecently(ctx, address, body);
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
    }

    private static synchronized boolean checkedRecently(Context ctx, String address, String body) {
        try {
            JSONObject map = new JSONObject(prefs(ctx).getString(KEY_CHECKED, "{}"));
            long at = map.optLong(PromptQueue.smsKey(body, address), 0);
            return at > 0 && System.currentTimeMillis() - at < CHECKED_TTL_MS;
        } catch (Exception e) {
            return false;
        }
    }

    /** Count one call against today's cap; false once the cap is reached. */
    private static synchronized boolean takeQuota(Context ctx) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        String raw = prefs(ctx).getString(KEY_DAILY, "");
        int used = raw.startsWith(today + "|") ? parseInt(raw.substring(today.length() + 1)) : 0;
        if (used >= DAILY_CAP) return false;
        prefs(ctx).edit().putString(KEY_DAILY, today + "|" + (used + 1)).apply();
        return true;
    }

    private static int parseInt(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return 0;
        }
    }

    private static synchronized void markChecked(Context ctx, String address, String body) {
        JSONObject map;
        try {
            map = new JSONObject(prefs(ctx).getString(KEY_CHECKED, "{}"));
        } catch (Exception e) {
            map = new JSONObject();
        }
        long cutoff = System.currentTimeMillis() - CHECKED_TTL_MS;
        JSONObject kept = new JSONObject();
        Iterator<String> keys = map.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            long at = map.optLong(k, 0);
            if (at >= cutoff) {
                try { kept.put(k, at); } catch (Exception ignored) { }
            }
        }
        try {
            kept.put(PromptQueue.smsKey(body, address), System.currentTimeMillis());
        } catch (Exception ignored) {
            return;
        }
        prefs(ctx).edit().putString(KEY_CHECKED, kept.toString()).apply();
    }

    /** What the AI decided, for the receiver to act on. */
    static final class Outcome {
        /** "expense", "income", "bill", "paid" or null (nothing to do). */
        String action;
        AiClient.MessageKind kind;
    }

    /**
     * Ask the AI (blocking; call off the main thread). Bills and "payment
     * received" are stored here; an expense / income is stored in AI_FOUND and
     * returned so the receiver can show the alert.
     */
    static Outcome run(Context ctx, String address, String body, long smsMs) {
        Outcome out = new Outcome();
        if (!takeQuota(ctx)) return out;
        String today = new SimpleDateFormat("yyyy-MM-dd (EEEE)", Locale.ENGLISH).format(new Date(smsMs));
        AiClient.MessageKind k = AiClient.classifyMessage(ctx, address, body, today, 15000);
        if (k == null) return out; // Failed / offline: not marked, so it's tried again later.
        markChecked(ctx, address, body);
        out.kind = k;
        // Step 1: low confidence never creates anything.
        if ("low".equals(k.confidence)) return out;
        switch (k.type) {
            case "bill_due":
                if (BillReminders.enabled(ctx) && BillReminders.storeFromAi(ctx, address, k, smsMs)) {
                    out.action = "bill";
                    BillReminders.schedule(ctx);
                    BillReminders.check(ctx);
                }
                break;
            case "payment_received":
                if (BillReminders.markPaid(ctx, address, k.last4, smsMs)) out.action = "paid";
                break;
            case "expense":
            case "income":
            case "refund":
                // Paid with Artha's Scan & Pay moments ago: already recorded, nothing to do.
                if ("expense".equals(k.type) && UpiRecent.consume(ctx, k.amount)) break;
                if (k.amount > 0) {
                    storeFound(ctx, address, body, smsMs, k);
                    out.action = "expense".equals(k.type) ? "expense" : "income";
                }
                break;
            default:
                break;
        }
        return out;
    }

    private static synchronized void storeFound(Context ctx, String address, String body, long smsMs,
                                                AiClient.MessageKind k) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(ctx).getString(KEY_AI_FOUND, "[]"));
        } catch (Exception e) {
            list = new JSONArray();
        }
        try {
            list.put(new JSONObject()
                .put("address", address == null ? "" : address)
                .put("body", body)
                .put("date", smsMs)
                .put("type", k.type)
                .put("amount", k.amount)
                .put("merchant", k.merchant)
                .put("last4", k.last4)
                .put("confidence", k.confidence));
        } catch (Exception ignored) {
            return;
        }
        while (list.length() > FOUND_MAX) list.remove(0);
        prefs(ctx).edit().putString(KEY_AI_FOUND, list.toString()).apply();
    }

    /** Hand the AI-found expenses to the app (once). Ones already added / dismissed on the alert are skipped. */
    static synchronized JSONArray consumeFound(Context ctx) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(ctx).getString(KEY_AI_FOUND, "[]"));
        } catch (Exception e) {
            list = new JSONArray();
        }
        prefs(ctx).edit().remove(KEY_AI_FOUND).apply();
        JSONArray out = new JSONArray();
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            if (PromptQueue.isResolved(ctx, o.optString("body"), o.optString("address"))) continue;
            out.put(o);
        }
        return out;
    }

    /** "₹1,234.50" for the alert. */
    static String amountText(double v) {
        java.text.NumberFormat f = java.text.NumberFormat.getNumberInstance(new Locale("en", "IN"));
        f.setMinimumFractionDigits(v % 1 == 0 ? 0 : 2);
        f.setMaximumFractionDigits(2);
        return f.format(v);
    }

    /** Today's used / cap, for Settings. */
    static int usedToday(Context ctx) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
        String raw = prefs(ctx).getString(KEY_DAILY, "");
        return raw.startsWith(today + "|") ? parseInt(raw.substring(today.length() + 1)) : 0;
    }
}
