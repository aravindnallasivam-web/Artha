package com.artha.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;

/**
 * Minimal SMS reader for expense capture.
 *
 * Exposes the user's SMS inbox (one-off backfill scan) and a live listener for
 * incoming messages. Parsing/classification happens in the web layer — this
 * plugin only surfaces raw {address, body, date} so bank messages never leave
 * the device. Android only.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        ),
        @Permission(
            alias = "send",
            strings = { Manifest.permission.SEND_SMS }
        ),
        @Permission(
            alias = "phone",
            strings = { Manifest.permission.READ_PHONE_STATE }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private BroadcastReceiver receiver;

    /**
     * Request only the core SMS permissions automatically. READ_PHONE_STATE
     * (for SIM selection) is deliberately excluded here and requested on demand
     * via {@link #requestPhonePermission(PluginCall)}, so enabling SMS capture
     * never prompts for phone access.
     */
    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestPermissionForAliases(new String[]{ "sms", "notifications", "send" }, call, "corePermsCallback");
    }

    @PermissionCallback
    private void corePermsCallback(PluginCall call) {
        call.resolve(permStatus());
    }

    /** Request READ_PHONE_STATE so the SIM picker can list the active SIMs. */
    @PluginMethod
    public void requestPhonePermission(PluginCall call) {
        if (getPermissionState("phone") == PermissionState.GRANTED) {
            call.resolve(permStatus());
            return;
        }
        requestPermissionForAlias("phone", call, "phonePermsCallback");
    }

    @PermissionCallback
    private void phonePermsCallback(PluginCall call) {
        call.resolve(permStatus());
    }

    /** Current state of every permission alias, as the JS layer expects. */
    private JSObject permStatus() {
        JSObject r = new JSObject();
        r.put("sms", getPermissionState("sms").toString());
        r.put("notifications", getPermissionState("notifications").toString());
        r.put("send", getPermissionState("send").toString());
        r.put("phone", getPermissionState("phone").toString());
        return r;
    }

    /** List the active SIM cards so the user can choose which one sends an SMS. */
    @PluginMethod
    public void getSimCards(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray sims = new JSArray();
        if (getPermissionState("phone") != PermissionState.GRANTED) {
            ret.put("permissionGranted", false);
            ret.put("sims", sims);
            call.resolve(ret);
            return;
        }
        try {
            SubscriptionManager sm =
                (SubscriptionManager) getContext().getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            List<SubscriptionInfo> infos = sm != null ? sm.getActiveSubscriptionInfoList() : null;
            if (infos != null) {
                for (SubscriptionInfo info : infos) {
                    if (info == null) {
                        continue;
                    }
                    JSObject s = new JSObject();
                    s.put("subscriptionId", info.getSubscriptionId());
                    s.put("slotIndex", info.getSimSlotIndex());
                    CharSequence displayName = info.getDisplayName();
                    CharSequence carrierName = info.getCarrierName();
                    s.put("displayName", displayName != null ? displayName.toString() : "");
                    s.put("carrierName", carrierName != null ? carrierName.toString() : "");
                    String number = null;
                    try {
                        number = info.getNumber();
                    } catch (Exception ignored) {
                        // getNumber may be restricted; the number is optional.
                    }
                    s.put("number", number != null ? number : "");
                    sims.put(s);
                }
            }
            ret.put("permissionGranted", true);
            ret.put("sims", sims);
            call.resolve(ret);
        } catch (SecurityException se) {
            ret.put("permissionGranted", false);
            ret.put("sims", sims);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not read SIM cards: " + e.getMessage());
        }
    }

    /** Read recent inbox messages, optionally only those newer than `since` (epoch ms). */
    @PluginMethod
    public void readInbox(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }

        Long sinceArg = call.getLong("since");
        long since = sinceArg != null ? sinceArg : 0L;
        Integer limitArg = call.getInt("limit", 200);
        int limit = limitArg != null ? limitArg : 200;

        JSArray messages = new JSArray();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        String selection = since > 0 ? Telephony.Sms.DATE + " > ?" : null;
        String[] args = since > 0 ? new String[] { String.valueOf(since) } : null;
        String sortOrder = Telephony.Sms.DATE + " DESC LIMIT " + limit;

        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri, projection, selection, args, sortOrder);
            if (cursor != null) {
                int idxAddr = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int idxBody = cursor.getColumnIndex(Telephony.Sms.BODY);
                int idxDate = cursor.getColumnIndex(Telephony.Sms.DATE);
                while (cursor.moveToNext()) {
                    JSObject m = new JSObject();
                    m.put("address", idxAddr >= 0 ? cursor.getString(idxAddr) : "");
                    m.put("body", idxBody >= 0 ? cursor.getString(idxBody) : "");
                    m.put("date", idxDate >= 0 ? cursor.getLong(idxDate) : 0L);
                    messages.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read SMS inbox: " + e.getMessage());
            return;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        JSObject ret = new JSObject();
        ret.put("messages", messages);
        call.resolve(ret);
    }

    /** Start emitting a `smsReceived` event for every incoming message. */
    @PluginMethod
    public void startWatch(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted");
            return;
        }
        registerReceiver();
        call.resolve();
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        unregisterReceiverSafely();
        call.resolve();
    }

    /** Send a balance-enquiry SMS to the bank. */
    @PluginMethod
    public void sendSms(PluginCall call) {
        if (getPermissionState("send") != PermissionState.GRANTED) {
            call.reject("SEND_SMS permission not granted");
            return;
        }
        String to = call.getString("to");
        String body = call.getString("body");
        if (to == null || to.trim().isEmpty() || body == null || body.trim().isEmpty()) {
            call.reject("Missing 'to' or 'body'");
            return;
        }
        Integer subscriptionId = call.getInt("subscriptionId");
        try {
            SmsManager sms = smsManagerFor(subscriptionId);
            sms.sendTextMessage(to.trim(), null, body, null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not send SMS: " + e.getMessage());
        }
    }

    /**
     * Resolve the {@link SmsManager} to use. When a valid subscription id is
     * given, bind to that SIM; otherwise use the system default SIM.
     */
    private SmsManager smsManagerFor(Integer subscriptionId) {
        boolean specificSim = subscriptionId != null && subscriptionId >= 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SmsManager base = getContext().getSystemService(SmsManager.class);
            if (specificSim && base != null) {
                return base.createForSubscriptionId(subscriptionId);
            }
            return base != null ? base : SmsManager.getDefault();
        }
        if (specificSim) {
            return SmsManager.getSmsManagerForSubscriptionId(subscriptionId);
        }
        return SmsManager.getDefault();
    }

    /** Persist the (already-normalised) ignored senders for the background receiver. */
    @PluginMethod
    public void setIgnoredSenders(PluginCall call) {
        JSArray senders = call.getArray("senders");
        StringBuilder csv = new StringBuilder();
        if (senders != null) {
            try {
                for (Object value : senders.toList()) {
                    if (value == null) {
                        continue;
                    }
                    if (csv.length() > 0) {
                        csv.append(",");
                    }
                    csv.append(value.toString());
                }
            } catch (org.json.JSONException ignored) {
                // Leave whatever we accumulated.
            }
        }
        getContext()
            .getSharedPreferences(SmsBackgroundReceiver.PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(SmsBackgroundReceiver.KEY_IGNORED, csv.toString())
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void setNotificationMappings(PluginCall call) {
        JSObject accountNames = call.getObject("accountNames");
        JSObject categoryNames = call.getObject("categoryNames");
        getContext()
            .getSharedPreferences(SmsBackgroundReceiver.PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .putString(SmsBackgroundReceiver.KEY_ACCOUNT_NAMES,
                accountNames != null ? accountNames.toString() : "{}")
            .putString(SmsBackgroundReceiver.KEY_CATEGORY_NAMES,
                categoryNames != null ? categoryNames.toString() : "{}")
            .apply();
        call.resolve();
    }

    /**
     * If this launch came from tapping a background "expense detected"
     * notification, hand back the SMS that triggered it (once) so the web layer
     * can open the confirm dialog immediately. Returns { message: null } when the
     * app was opened any other way.
     */
    @PluginMethod
    public void consumePendingSms(PluginCall call) {
        JSObject ret = new JSObject();
        android.app.Activity activity = getActivity();
        Intent intent = activity != null ? activity.getIntent() : null;
        boolean fromNotification =
            intent != null && intent.getBooleanExtra(SmsBackgroundReceiver.EXTRA_OPEN_SMS, false);
        if (!fromNotification) {
            ret.put("message", null);
            call.resolve(ret);
            return;
        }

        // True when the user tapped the notification's "Add" action (vs the body).
        boolean autoLog = intent.getBooleanExtra(SmsBackgroundReceiver.EXTRA_ACTION_ADD, false);

        // Consume the flags so a later plain resume doesn't re-open the dialog.
        intent.removeExtra(SmsBackgroundReceiver.EXTRA_OPEN_SMS);
        intent.removeExtra(SmsBackgroundReceiver.EXTRA_ACTION_ADD);
        activity.setIntent(intent);

        android.content.SharedPreferences prefs =
            getContext().getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
        String body = prefs.getString(SmsBackgroundReceiver.KEY_PENDING_BODY, null);
        if (body == null || body.isEmpty()) {
            ret.put("message", null);
            call.resolve(ret);
            return;
        }
        String address = prefs.getString(SmsBackgroundReceiver.KEY_PENDING_ADDRESS, "");
        long date = prefs.getLong(SmsBackgroundReceiver.KEY_PENDING_DATE, System.currentTimeMillis());
        prefs.edit()
            .remove(SmsBackgroundReceiver.KEY_PENDING_BODY)
            .remove(SmsBackgroundReceiver.KEY_PENDING_ADDRESS)
            .remove(SmsBackgroundReceiver.KEY_PENDING_DATE)
            .apply();

        JSObject message = new JSObject();
        message.put("address", address);
        message.put("body", body);
        message.put("date", date);
        ret.put("message", message);
        ret.put("autoLog", autoLog);
        call.resolve(ret);
    }

    private void registerReceiver() {
        if (receiver != null) {
            return;
        }
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                // Foreground only: when backgrounded/closed the manifest receiver
                // posts a notification instead, so we don't double-handle.
                if (!MainActivity.isForeground) {
                    return;
                }
                SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
                if (parts == null || parts.length == 0) {
                    return;
                }
                StringBuilder body = new StringBuilder();
                String address = "";
                long date = System.currentTimeMillis();
                for (SmsMessage part : parts) {
                    if (part == null) {
                        continue;
                    }
                    body.append(part.getMessageBody());
                    String from = part.getOriginatingAddress();
                    if (from != null) {
                        address = from;
                    }
                    date = part.getTimestampMillis();
                }
                JSObject data = new JSObject();
                data.put("address", address);
                data.put("body", body.toString());
                data.put("date", date);
                notifyListeners("smsReceived", data, true);
            }
        };

        IntentFilter filter = new IntentFilter("android.provider.Telephony.SMS_RECEIVED");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
    }

    private void unregisterReceiverSafely() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // Already unregistered.
            }
            receiver = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterReceiverSafely();
        super.handleOnDestroy();
    }
}
