package com.artha.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Detected expense SMS waiting on the full-screen prompt, oldest first. Each
 * SMS that arrives while one is already showing is appended, and the prompt
 * walks through them ("1 of 3"). Opening Artha clears it: the app's own scan
 * picks up anything left as Pending expenses.
 */
final class PromptQueue {

    private static final String KEY = "prompt_queue";
    /** Never keep more than this; older ones still reach Pending expenses. */
    private static final int MAX = 20;
    /** Entries older than this are dropped (the app scan has them by then). */
    private static final long MAX_AGE_MS = 12L * 60 * 60 * 1000;

    private PromptQueue() {}

    static final String F_AMOUNT = "amountDisplay";
    static final String F_MERCHANT = "merchant";
    static final String F_CATEGORY = "category";
    static final String F_ACCOUNT = "account";
    static final String F_BODY = "body";
    static final String F_ADDRESS = "address";
    static final String F_DATE = "date";
    static final String F_TEST = "test";

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONArray all(Context ctx) {
        JSONArray raw;
        try {
            raw = new JSONArray(prefs(ctx).getString(KEY, "[]"));
        } catch (JSONException e) {
            raw = new JSONArray();
        }
        long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
        JSONArray fresh = new JSONArray();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject o = raw.optJSONObject(i);
            if (o != null && o.optLong(F_DATE, 0) >= cutoff) {
                fresh.put(o);
            }
        }
        return fresh;
    }

    static synchronized void add(Context ctx, JSONObject entry) {
        JSONArray list = all(ctx);
        // The same SMS twice (e.g. a re-delivered broadcast) stays one entry.
        String body = entry.optString(F_BODY, "");
        String address = entry.optString(F_ADDRESS, "");
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && !body.isEmpty() && body.equals(o.optString(F_BODY))
                && address.equals(o.optString(F_ADDRESS))) {
                return;
            }
        }
        list.put(entry);
        while (list.length() > MAX) {
            list.remove(0);
        }
        save(ctx, list);
    }

    static synchronized JSONObject first(Context ctx) {
        JSONArray list = all(ctx);
        return list.length() > 0 ? list.optJSONObject(0) : null;
    }

    static synchronized void removeFirst(Context ctx) {
        JSONArray list = all(ctx);
        if (list.length() > 0) {
            list.remove(0);
        }
        save(ctx, list);
    }

    static synchronized void clear(Context ctx) {
        prefs(ctx).edit().remove(KEY).apply();
    }

    static int size(Context ctx) {
        return all(ctx).length();
    }

    private static void save(Context ctx, JSONArray list) {
        // commit(): the prompt reads this right after the receiver writes it.
        prefs(ctx).edit().putString(KEY, list.toString()).commit();
    }
}
