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
    /** SMS already added / dismissed / handed to the app: key → time handled. */
    private static final String KEY_RESOLVED = "prompt_resolved";
    /** How long a handled SMS stays blocked from prompting again. */
    private static final long RESOLVED_TTL_MS = 6L * 60 * 60 * 1000;
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

    /**
     * Queue an SMS for the prompt. False when it's already waiting or was
     * handled recently (a re-delivered broadcast): the caller then shows nothing.
     */
    static synchronized boolean add(Context ctx, JSONObject entry) {
        JSONArray list = all(ctx);
        String body = entry.optString(F_BODY, "");
        String address = entry.optString(F_ADDRESS, "");
        if (!entry.optBoolean(F_TEST, false) && isResolved(ctx, body, address)) {
            return false;
        }
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && !body.isEmpty() && body.equals(o.optString(F_BODY))
                && address.equals(o.optString(F_ADDRESS))) {
                return false;
            }
        }
        list.put(entry);
        while (list.length() > MAX) {
            list.remove(0);
        }
        save(ctx, list);
        return true;
    }

    /** True when this SMS was added, dismissed or handed to the app recently. */
    static synchronized boolean isResolved(Context ctx, String body, String address) {
        if (body == null || body.isEmpty()) return false;
        long at = resolvedMap(ctx).optLong(key(body, address), 0);
        return at > 0 && System.currentTimeMillis() - at < RESOLVED_TTL_MS;
    }

    /** Remember an SMS as handled so a late or duplicate launch won't show it again. */
    static synchronized void markResolved(Context ctx, String body, String address) {
        if (body == null || body.isEmpty()) return;
        JSONObject map = resolvedMap(ctx);
        long cutoff = System.currentTimeMillis() - RESOLVED_TTL_MS;
        JSONObject kept = new JSONObject();
        java.util.Iterator<String> keys = map.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            long at = map.optLong(k, 0);
            if (at >= cutoff) {
                try { kept.put(k, at); } catch (JSONException ignored) { }
            }
        }
        try {
            kept.put(key(body, address), System.currentTimeMillis());
        } catch (JSONException ignored) {
            return;
        }
        prefs(ctx).edit().putString(KEY_RESOLVED, kept.toString()).commit();
    }

    private static JSONObject resolvedMap(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString(KEY_RESOLVED, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    /** Stable key for one SMS (also used by NearbyPlaces and the app's JS). */
    static String smsKey(String body, String address) {
        return key(body == null ? "" : body, address);
    }

    private static String key(String body, String address) {
        return (address == null ? "" : address) + "|" + body.hashCode() + "|" + body.length();
    }

    private static void markResolved(Context ctx, JSONObject entry) {
        if (entry != null && !entry.optBoolean(F_TEST, false)) {
            markResolved(ctx, entry.optString(F_BODY, ""), entry.optString(F_ADDRESS, ""));
        }
    }

    static synchronized JSONObject first(Context ctx) {
        JSONArray list = all(ctx);
        return list.length() > 0 ? list.optJSONObject(0) : null;
    }

    static synchronized void removeFirst(Context ctx) {
        JSONArray list = all(ctx);
        if (list.length() > 0) {
            markResolved(ctx, list.optJSONObject(0));
            list.remove(0);
        }
        save(ctx, list);
    }

    /** Drop every waiting SMS (each is remembered as handled). */
    static synchronized void clear(Context ctx) {
        JSONArray list = all(ctx);
        for (int i = 0; i < list.length(); i++) {
            markResolved(ctx, list.optJSONObject(i));
        }
        prefs(ctx).edit().remove(KEY).commit();
    }

    static int size(Context ctx) {
        return all(ctx).length();
    }

    private static void save(Context ctx, JSONArray list) {
        // commit(): the prompt reads this right after the receiver writes it.
        prefs(ctx).edit().putString(KEY, list.toString()).commit();
    }
}
