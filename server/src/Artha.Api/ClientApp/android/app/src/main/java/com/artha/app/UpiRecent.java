package com.artha.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Payments started from Artha's Scan & Pay. Already recorded in the app, so
 * the bank's debit SMS for the same payment should not prompt again. A debit
 * SMS is only taken as that payment when the amount is equal AND it names the
 * UPI reference, the payee's UPI id or name - or, with nothing to compare,
 * it's a non-card SMS within 30 minutes. A different payment of the same
 * amount (a card spend, another shop) still prompts.
 */
final class UpiRecent {

    private static final String KEY = "upi_recent";
    private static final long WINDOW_MS = 3L * 60 * 60 * 1000;
    private static final long AMOUNT_ONLY_MS = 30L * 60 * 1000;

    private UpiRecent() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void add(Context ctx, double amount, String vpa, String name) {
        if (amount <= 0) return;
        JSONArray list = fresh(ctx);
        try {
            list.put(new JSONObject()
                .put("amount", amount)
                .put("at", System.currentTimeMillis())
                .put("vpa", vpa == null ? "" : vpa.toLowerCase(Locale.ROOT))
                .put("name", name == null ? "" : name)
                .put("ref", ""));
        } catch (Exception ignored) {
            return;
        }
        save(ctx, list);
    }

    /** The UPI app's reference for the latest payment of this amount (bank SMS usually quote it). */
    static synchronized void setRef(Context ctx, double amount, String ref) {
        if (ref == null || ref.trim().isEmpty()) return;
        JSONArray list = fresh(ctx);
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && same(o.optDouble("amount"), amount) && o.optString("ref").isEmpty()) {
                try { o.put("ref", ref.trim()); } catch (Exception ignored) { }
                break;
            }
        }
        save(ctx, list);
    }

    /** Forget the latest payment of this amount (it didn't go through). */
    static synchronized void forget(Context ctx, double amount) {
        JSONArray list = fresh(ctx);
        for (int i = list.length() - 1; i >= 0; i--) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && same(o.optDouble("amount"), amount)) {
                list.remove(i);
                break;
            }
        }
        save(ctx, list);
    }

    /** True (and forgets it) when this debit SMS is a payment made with Scan & Pay. */
    static synchronized boolean consume(Context ctx, double amount, String body) {
        JSONArray list = fresh(ctx);
        int hit = matchIndex(list, amount, body == null ? "" : body);
        if (hit < 0) return false;
        list.remove(hit);
        save(ctx, list);
        return true;
    }

    static int matchIndex(JSONArray list, double amount, String body) {
        String text = body.toLowerCase(Locale.ROOT);
        String flat = text.replaceAll("[^a-z0-9]", "");
        boolean cardSpend = text.matches("(?s).*\\b(card|pos|atm)\\b.*");
        // An SMS naming a UPI id or a 12-digit UPI reference is someone else's unless it matches below.
        boolean namesPayee = java.util.regex.Pattern.compile("[a-z0-9._-]{2,}@[a-z]{2,}").matcher(text).find();
        java.util.List<String> refs = new java.util.ArrayList<>();
        java.util.regex.Matcher rm = java.util.regex.Pattern.compile("\\b\\d{12}\\b").matcher(text);
        while (rm.find()) refs.add(rm.group());
        long now = System.currentTimeMillis();
        int amountOnly = -1;
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null || !same(o.optDouble("amount"), amount)) continue;
            String ref = o.optString("ref");
            String vpa = o.optString("vpa");
            String local = vpa.contains("@") ? vpa.substring(0, vpa.indexOf('@')) : vpa;
            String nameKey = nameKey(o.optString("name"));
            if (ref.length() >= 6 && text.contains(ref.toLowerCase(Locale.ROOT))) return i;
            if (!vpa.isEmpty() && text.contains(vpa)) return i;
            if (local.length() >= 4 && flat.contains(local.replaceAll("[^a-z0-9]", ""))) return i;
            if (nameKey.length() >= 4 && flat.contains(nameKey)) return i;
            boolean otherRef = !ref.isEmpty() && !refs.isEmpty() && !refs.contains(ref);
            if (!cardSpend && !namesPayee && !otherRef && amountOnly < 0 && now - o.optLong("at") <= AMOUNT_ONLY_MS) {
                amountOnly = i;
            }
        }
        return amountOnly;
    }

    /** "Blue Tokai Coffee" → "bluetokai": the first words, enough to spot in an SMS. */
    private static String nameKey(String name) {
        String[] words = name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String w : words) {
            if (sb.length() >= 8) break;
            sb.append(w);
        }
        return sb.toString();
    }

    private static boolean same(double a, double b) {
        return Math.abs(a - b) < 0.005;
    }

    private static void save(Context ctx, JSONArray list) {
        prefs(ctx).edit().putString(KEY, list.toString()).apply();
    }

    private static JSONArray fresh(Context ctx) {
        JSONArray out = new JSONArray();
        try {
            JSONArray raw = new JSONArray(prefs(ctx).getString(KEY, "[]"));
            long cutoff = System.currentTimeMillis() - WINDOW_MS;
            for (int i = 0; i < raw.length(); i++) {
                JSONObject o = raw.optJSONObject(i);
                if (o != null && o.optLong("at") >= cutoff) out.put(o);
            }
        } catch (Exception ignored) {
            // Start over.
        }
        return out;
    }

    static double parseAmount(String s) {
        try {
            return Double.parseDouble(s.replace(",", ""));
        } catch (Exception e) {
            return 0;
        }
    }
}
