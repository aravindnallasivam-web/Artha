package com.artha.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Dismiss handler for the SMS-detected expense notification. Fired from the
 * notification's Dismiss action button and from the swipe-to-dismiss delete
 * intent. Silent: never launches the Activity. Clears the pending-SMS stash
 * that {@link SmsBackgroundReceiver} wrote on arrival so the app does NOT
 * pop the review dialog on next launch for a user who already said no.
 */
public class SmsActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!SmsBackgroundReceiver.ACTION_DISMISS.equals(intent.getAction())) {
            return;
        }

        // Cancel the visible notification (if it's still showing — swipe-dismiss
        // path invokes this receiver after the system has already removed it,
        // so cancel() is harmless on no-op).
        int notifId = intent.getIntExtra(SmsBackgroundReceiver.EXTRA_NOTIF_ID,
            /* fallback */ -1);
        if (notifId > 0) {
            NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(notifId);
            }
        }

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
}
