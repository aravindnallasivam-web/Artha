package com.artha.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Payments started from Artha's Scan & Pay. Already recorded in the app, so
 * the bank's debit SMS for the same amount shortly after should not prompt
 * again: the receiver consumes the match instead of showing the alert.
 */
final class UpiRecent {

    private static final String KEY = "upi_recent";
    private static final long WINDOW_MS = 3L * 60 * 60 * 1000;

    private UpiRecent() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void add(Context ctx, double amount) {
        if (amount <= 0) return;
        JSONArray list = fresh(ctx);
        try {
            list.put(new JSONObject().put("amount", amount).put("at", System.currentTimeMillis()));
        } catch (Exception ignored) {
            return;
        }
        prefs(ctx).edit().putString(KEY, list.toString()).apply();
    }

    /** True (and forgets it) when a Scan & Pay payment of this amount was made in the last 3 hours. */
    static synchronized boolean consume(Context ctx, double amount) {
        JSONArray list = fresh(ctx);
        JSONArray kept = new JSONArray();
        boolean hit = false;
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            if (!hit && Math.abs(o.optDouble("amount") - amount) < 0.005) {
                hit = true;
                continue;
            }
            kept.put(o);
        }
        if (hit) prefs(ctx).edit().putString(KEY, kept.toString()).apply();
        return hit;
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
