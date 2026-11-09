package com.artha.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.Toast;

/**
 * Action handler for the SMS-detected expense notification. Backs two buttons:
 *
 *  - Dismiss: silent, mirrors swipe-to-dismiss. Clears the pending-SMS stash so
 *    the review dialog does NOT auto-pop on next launch.
 *  - Approve: silent, appends a pre-approved entry to SharedPreferences. The
 *    Angular layer drains that queue on next organic app open and quietly
 *    syncs each entry to Drive. Never launches the Activity.
 *
 * Both paths cancel the posted notification. The lock-screen SmsPromptActivity
 * uses its own helpers that reach into the same preferences, so the behaviour
 * is identical whether the user tapped a notification button or the big
 * circular button on the full-screen takeover.
 */
public class SmsActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        // Test prompt (Settings → Test lock-screen alert): just clear it.
        if (intent.getBooleanExtra(SmsPromptActivity.EXTRA_TEST, false)) {
            cancelNotification(context, intent);
            return;
        }
        if (SmsBackgroundReceiver.ACTION_DISMISS.equals(action)) {
            handleDismiss(context, intent);
            return;
        }
        if (SmsBackgroundReceiver.ACTION_APPROVE.equals(action)) {
            handleApprove(context, intent);
        }
    }

    private void handleDismiss(Context context, Intent intent) {
        cancelNotification(context, intent);

        // Clear the pending-SMS stash so consumePendingSms() on next app resume
        // returns null and the review modal does NOT auto-pop for a message the
        // user explicitly dismissed. We leave the ignored-sender list alone —
        // this dismisses this one notification, not every future SMS from this
        // sender; that's what the "Ignored senders" settings screen is for.
        context.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(SmsBackgroundReceiver.KEY_PENDING_BODY)
            .remove(SmsBackgroundReceiver.KEY_PENDING_ADDRESS)
            .remove(SmsBackgroundReceiver.KEY_PENDING_DATE)
            .apply();
    }

    private void handleApprove(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(
            SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);

        String raw = prefs.getString(SmsPromptActivity.KEY_PRE_APPROVED, "[]");
        org.json.JSONArray arr;
        try {
            arr = new org.json.JSONArray(raw);
        } catch (org.json.JSONException e) {
            arr = new org.json.JSONArray();
        }
        try {
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("address",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_ADDRESS)));
            entry.put("body",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_BODY)));
            entry.put("date",
                intent.getLongExtra(SmsPromptActivity.EXTRA_DATE, System.currentTimeMillis()));
            entry.put("amountDisplay",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_AMOUNT_DISPLAY)));
            entry.put("merchant",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_MERCHANT)));
            entry.put("category",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_CATEGORY)));
            entry.put("account",
                emptyIfNull(intent.getStringExtra(SmsPromptActivity.EXTRA_ACCOUNT)));
            entry.put("approvedAt", System.currentTimeMillis());
            arr.put(entry);
            prefs.edit()
                .putString(SmsPromptActivity.KEY_PRE_APPROVED, arr.toString())
                // Approving consumes the pending-SMS stash too — this
                // message has been handled, no need for the review dialog
                // to re-pop on next app open.
                .remove(SmsBackgroundReceiver.KEY_PENDING_BODY)
                .remove(SmsBackgroundReceiver.KEY_PENDING_ADDRESS)
                .remove(SmsBackgroundReceiver.KEY_PENDING_DATE)
                .apply();
        } catch (org.json.JSONException ignored) {
        }

        cancelNotification(context, intent);
        try {
            Toast.makeText(context, R.string.prompt_added, Toast.LENGTH_SHORT).show();
        } catch (Exception ignored) {
            // Receiver context may refuse a toast on some OEMs; silent is fine.
        }
    }

    private void cancelNotification(Context context, Intent intent) {
        int notifId = intent.getIntExtra(SmsBackgroundReceiver.EXTRA_NOTIF_ID, -1);
        if (notifId > 0) {
            NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(notifId);
            }
        }
    }

    private static String emptyIfNull(String value) {
        return value != null ? value : "";
    }
}
