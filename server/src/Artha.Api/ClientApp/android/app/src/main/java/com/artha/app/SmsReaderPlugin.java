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
import com.getcapacitor.annotation.ActivityCallback;
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
        ),
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
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

    /** Request location for "Nearby shops" on the expense prompt (only when the user turns it on). */
    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            call.resolve(permStatus());
            return;
        }
        requestPermissionForAlias("location", call, "locationPermsCallback");
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        call.resolve(permStatus());
    }

    /** Current state of every permission alias, as the JS layer expects. */
    private JSObject permStatus() {
        JSObject r = new JSObject();
        r.put("sms", getPermissionState("sms").toString());
        r.put("notifications", getPermissionState("notifications").toString());
        r.put("send", getPermissionState("send").toString());
        r.put("phone", getPermissionState("phone").toString());
        r.put("location", getPermissionState("location").toString());
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

    /** Read inbox messages, newest first, optionally only those after `since` and up to `until` (epoch ms). */
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
        // Optional upper bound, so a past range isn't crowded out by newer messages.
        Long untilArg = call.getLong("until");
        long until = untilArg != null ? untilArg : 0L;
        java.util.List<String> clauses = new java.util.ArrayList<>();
        java.util.List<String> values = new java.util.ArrayList<>();
        if (since > 0) {
            clauses.add(Telephony.Sms.DATE + " > ?");
            values.add(String.valueOf(since));
        }
        if (until > 0) {
            clauses.add(Telephony.Sms.DATE + " <= ?");
            values.add(String.valueOf(until));
        }
        String selection = clauses.isEmpty() ? null : android.text.TextUtils.join(" AND ", clauses);
        String[] args = values.isEmpty() ? null : values.toArray(new String[0]);
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
        // Optional full lists for the prompt's pickers (older web builds omit them).
        JSArray categories = call.getArray("categories");
        JSArray accounts = call.getArray("accounts");
        android.content.SharedPreferences.Editor editor = getContext()
            .getSharedPreferences(SmsBackgroundReceiver.PREFS, android.content.Context.MODE_PRIVATE)
            .edit();
        if (categories != null) {
            editor.putString(SmsBackgroundReceiver.KEY_CATEGORY_LIST, categories.toString());
        }
        if (accounts != null) {
            editor.putString(SmsBackgroundReceiver.KEY_ACCOUNT_LIST, accounts.toString());
        }
        // "Nearby shops" on the prompt: {enabled, googleKey}; absent leaves it as is.
        if (call.getData().has("nearby")) {
            JSObject nearby = call.getObject("nearby");
            editor.putString(NearbyPlaces.KEY_NEARBY, nearby != null ? nearby.toString() : "{}");
        }
        // AI provider for the full-screen prompt: an object to store, null to clear.
        // Absent (older web builds) leaves whatever is stored.
        if (call.getData().has("ai")) {
            JSObject ai = call.getObject("ai");
            if (ai != null && ai.length() > 0) {
                editor.putString(AiClient.KEY_AI_CONFIG, ai.toString());
            } else {
                editor.remove(AiClient.KEY_AI_CONFIG);
            }
        }
        JSObject accountHints = call.getObject("accountHints");
        editor.putString(SmsBackgroundReceiver.KEY_ACCOUNT_HINTS,
            accountHints != null ? accountHints.toString() : "{}");
        editor
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

    /**
     * Drain the pre-approved queue: entries written by the lock-screen Approve
     * button (SmsPromptActivity) and by the notification's Approve action
     * button (SmsActionReceiver). Each entry carries the original SMS plus
     * the account / category the background mapper resolved, so the web
     * layer can log the expense without re-prompting the user. Clears the
     * queue atomically — the caller gets each entry exactly once.
     */
    @PluginMethod
    public void consumePreApproved(PluginCall call) {
        // Artha is open: its own scan lists anything still waiting on the
        // full-screen prompt under Pending expenses, so drop that queue.
        PromptQueue.clear(getContext());
        android.content.SharedPreferences prefs = getContext()
            .getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(SmsPromptActivity.KEY_PRE_APPROVED, "[]");
        JSArray entries = new JSArray();
        try {
            org.json.JSONArray arr = new org.json.JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                org.json.JSONObject row = arr.optJSONObject(i);
                if (row == null) {
                    continue;
                }
                JSObject out = new JSObject();
                out.put("address", row.optString("address", ""));
                out.put("body", row.optString("body", ""));
                out.put("date", row.optLong("date", 0L));
                out.put("amountDisplay", row.optString("amountDisplay", ""));
                out.put("merchant", row.optString("merchant", ""));
                out.put("category", row.optString("category", ""));
                out.put("account", row.optString("account", ""));
                out.put("approvedAt", row.optLong("approvedAt", 0L));
                entries.put(out);
            }
        } catch (org.json.JSONException ignored) {
            // Fall through with whatever we accumulated; drop the malformed queue.
        }
        // Clear atomically — anything written after this read belongs to the
        // next drain, and the entries we handed out must never be seen twice.
        prefs.edit().remove(SmsPromptActivity.KEY_PRE_APPROVED).apply();

        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    /**
     * Report whether the Expense Detection notification will fire as a lock-
     * screen takeover ("full-screen intent"). Returns true on Android 13 and
     * below (the manifest permission is auto-granted). On Android 14+ returns
     * NotificationManager.canUseFullScreenIntent() — false until the user
     * grants Full-screen notifications under App info for Artha.
     */
    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < 34) {
            ret.put("granted", true);
            ret.put("supported", true);
            call.resolve(ret);
            return;
        }
        android.app.NotificationManager nm = (android.app.NotificationManager)
            getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        ret.put("granted", nm != null && nm.canUseFullScreenIntent());
        ret.put("supported", true);
        call.resolve(ret);
    }

    /**
     * Whether Artha may "Display over other apps". With it, the receiver's direct
     * startActivity() is exempt from Background Activity Launch limits, so the
     * expense prompt pops up on an unlocked phone instead of only a banner.
     */
    /**
     * Location fixes taken when expense SMS reached the alert:
     * { "<address>|<body.hashCode()>|<body.length()>": {lat,lng,accuracy,at,saved} }.
     */
    @PluginMethod
    public void getSmsLocations(PluginCall call) {
        String raw = getContext().getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .getString(NearbyPlaces.KEY_SMS_LOCATIONS, "{}");
        JSObject ret = new JSObject();
        try {
            ret.put("locations", new JSObject(raw));
        } catch (Exception e) {
            ret.put("locations", new JSObject());
        }
        call.resolve(ret);
    }

    // ---- Bill reminders ----

    private static volatile SmsReaderPlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
        BillReminders.schedule(getContext());
    }

    /** Tell the open app that the AI found an expense in an SMS ("aiSmsFound"). */
    static void notifyAiFound() {
        SmsReaderPlugin p = instance;
        if (p != null) {
            try {
                p.notifyListeners("aiSmsFound", new JSObject());
            } catch (Exception ignored) {
                // App not running: it drains the list on the next open.
            }
        }
    }

    /** Expenses / income the AI found in unrecognised SMS (handed out once). */
    @PluginMethod
    public void consumeAiFound(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("entries", new com.getcapacitor.JSArray(SmsAiFallback.consumeFound(getContext()).toString()));
        } catch (Exception e) {
            ret.put("entries", new com.getcapacitor.JSArray());
        }
        ret.put("usedToday", SmsAiFallback.usedToday(getContext()));
        call.resolve(ret);
    }

    /** Bills found in SMS: [{id,title,kind,last4,amount,minDue,dueDate,status,paidAt,...}]. */
    @PluginMethod
    public void getBills(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("bills", new com.getcapacitor.JSArray(BillReminders.all(getContext()).toString()));
        } catch (Exception e) {
            ret.put("bills", new com.getcapacitor.JSArray());
        }
        call.resolve(ret);
    }

    /** status: "paid" | "due" | "dismissed". */
    @PluginMethod
    public void setBillStatus(PluginCall call) {
        String id = call.getString("id");
        String status = call.getString("status");
        if (id == null || status == null) {
            call.reject("id and status are required");
            return;
        }
        BillReminders.setStatus(getContext(), id, status);
        call.resolve();
    }

    @PluginMethod
    public void setBillConfig(PluginCall call) {
        JSObject cfg = new JSObject();
        cfg.put("enabled", call.getBoolean("enabled", true));
        cfg.put("daysBefore", call.getInt("daysBefore", 3));
        getContext().getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .edit().putString(BillReminders.KEY_CONFIG, cfg.toString()).apply();
        BillReminders.schedule(getContext());
        call.resolve();
    }

    /** Pick up bills from the last `days` of the inbox (needs SMS permission). */
    @PluginMethod
    public void scanBills(PluginCall call) {
        int days = Math.max(1, Math.min(120, call.getInt("days", 45)));
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            int changed = BillReminders.scanInbox(ctx, System.currentTimeMillis() - days * 24L * 60 * 60 * 1000);
            BillReminders.check(ctx);
            JSObject ret = new JSObject();
            ret.put("changed", changed);
            call.resolve(ret);
        }, "artha-bill-scan").start();
    }

    /** A route to open once, e.g. "/bills" from a bill reminder tap; { route: null } otherwise. */
    @PluginMethod
    public void consumeOpenRoute(PluginCall call) {
        JSObject ret = new JSObject();
        android.app.Activity activity = getActivity();
        Intent intent = activity != null ? activity.getIntent() : null;
        String route = intent != null ? intent.getStringExtra(BillReminders.EXTRA_OPEN_ROUTE) : null;
        if (route != null) {
            intent.removeExtra(BillReminders.EXTRA_OPEN_ROUTE);
            activity.setIntent(intent);
        }
        ret.put("route", route);
        call.resolve(ret);
    }

    /**
     * Read the phone's location now and keep it for this SMS (the app is open,
     * so the alert didn't take one). Resolves { location: {lat,lng,accuracy,at} | null }.
     */
    @PluginMethod
    public void captureSmsLocation(PluginCall call) {
        final String address = call.getString("address", "");
        final String body = call.getString("body", "");
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            JSObject ret = new JSObject();
            android.location.Location loc = NearbyPlaces.saveLocationEnabled(ctx)
                ? NearbyPlaces.currentLocation(ctx, 6000) : null;
            if (loc != null) {
                NearbyPlaces.rememberForSms(ctx, address, body, loc);
                try {
                    ret.put("location", JSObject.fromJSONObject(NearbyPlaces.locationJson(loc)));
                } catch (Exception e) {
                    ret.put("location", null);
                }
            } else {
                ret.put("location", null);
            }
            call.resolve(ret);
        }, "artha-sms-location").start();
    }

    // ---- Scan & Pay (UPI) ----

    /** Scan a UPI QR code; resolves { qr: "upi://pay?..." } or { cancelled: true }. */
    @PluginMethod
    public void scanUpiQr(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraQrPermsCallback");
            return;
        }
        launchQrScan(call);
    }

    @PermissionCallback
    private void cameraQrPermsCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchQrScan(call);
        } else {
            call.reject("camera-denied");
        }
    }

    private void launchQrScan(PluginCall call) {
        Intent i = new Intent(getContext(), CardScanActivity.class).putExtra(CardScanActivity.EXTRA_MODE, "upi");
        startActivityForResult(call, i, "qrScanResult");
    }

    @ActivityCallback
    private void qrScanResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null) {
            ret.put("cancelled", true);
        } else {
            ret.put("qr", data.getStringExtra(CardScanActivity.EXTRA_QR));
        }
        call.resolve(ret);
    }

    /** Installed apps that can pay a upi://pay link: [{ packageName, label }]. */
    @PluginMethod
    public void listUpiApps(PluginCall call) {
        android.content.pm.PackageManager pm = getContext().getPackageManager();
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("upi://pay?pa=test@upi&pn=Test&am=1&cu=INR"));
        JSArray apps = new JSArray();
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (android.content.pm.ResolveInfo ri : pm.queryIntentActivities(probe, 0)) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(getContext().getPackageName()) || !seen.add(pkg)) continue;
            JSObject o = new JSObject();
            o.put("packageName", pkg);
            o.put("label", String.valueOf(ri.loadLabel(pm)));
            apps.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("apps", apps);
        call.resolve(ret);
    }

    /**
     * Open a UPI app with the payment filled in. Resolves when the user comes
     * back: { resultCode, response } where response is the app's
     * "txnId=..&responseCode=..&Status=SUCCESS&txnRef=.." text when it sends one.
     */
    @PluginMethod
    public void upiPay(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !uri.toLowerCase(java.util.Locale.ROOT).startsWith("upi:")) {
            call.reject("A upi:// link is required");
            return;
        }
        Intent pay = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        String pkg = call.getString("packageName");
        if (pkg != null && !pkg.isEmpty()) pay.setPackage(pkg);
        if (pay.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("no-upi-app");
            return;
        }
        // The bank's debit SMS for this payment shouldn't prompt again.
        UpiRecent.add(getContext(), call.getDouble("amount", 0d), call.getString("vpa", ""), call.getString("name", ""));
        startActivityForResult(call, pkg != null && !pkg.isEmpty() ? pay : Intent.createChooser(pay, "Pay with"), "upiPayResult");
    }

    /** The payment didn't go through: let the next debit SMS of this amount prompt as usual. */
    @PluginMethod
    public void upiForget(PluginCall call) {
        UpiRecent.forget(getContext(), call.getDouble("amount", 0d));
        call.resolve();
    }

    /** The UPI app's reference for a payment (bank SMS usually quote it): makes the SMS match exact. */
    @PluginMethod
    public void upiSetRef(PluginCall call) {
        UpiRecent.setRef(getContext(), call.getDouble("amount", 0d), call.getString("ref", ""));
        call.resolve();
    }

    @ActivityCallback
    private void upiPayResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("resultCode", result.getResultCode());
        Intent data = result.getData();
        String response = null;
        if (data != null) {
            response = data.getStringExtra("response");
            if (response == null && data.getExtras() != null) {
                // Some apps send separate extras instead of one response string.
                StringBuilder sb = new StringBuilder();
                for (String k : data.getExtras().keySet()) {
                    Object v = data.getExtras().get(k);
                    if (v != null) sb.append(sb.length() == 0 ? "" : "&").append(k).append('=').append(v);
                }
                response = sb.length() > 0 ? sb.toString() : null;
            }
        }
        ret.put("response", response);
        call.resolve(ret);
    }

    // ---- Card vault: scan a card with the camera ----

    /** Open the camera card scanner; resolves { number, expiry, name } or { cancelled: true }. */
    @PluginMethod
    public void scanCard(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermsCallback");
            return;
        }
        launchCardScan(call);
    }

    @PermissionCallback
    private void cameraPermsCallback(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchCardScan(call);
        } else {
            call.reject("camera-denied");
        }
    }

    private void launchCardScan(PluginCall call) {
        startActivityForResult(call, new Intent(getContext(), CardScanActivity.class), "cardScanResult");
    }

    @ActivityCallback
    private void cardScanResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null) {
            ret.put("cancelled", true);
        } else {
            ret.put("number", data.getStringExtra(CardScanActivity.EXTRA_NUMBER));
            ret.put("expiry", data.getStringExtra(CardScanActivity.EXTRA_EXPIRY));
            ret.put("name", data.getStringExtra(CardScanActivity.EXTRA_NAME));
        }
        call.resolve(ret);
    }

    // ---- Card vault: hardware-keystore seal + no screenshots ----

    /** Seal the vault key for fingerprint unlock (call right after a fingerprint check). */
    @PluginMethod
    public void vaultSeal(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("data is required");
            return;
        }
        try {
            JSObject ret = new JSObject();
            ret.put("sealed", VaultKeystore.seal(data));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not use the phone's secure key store: " + e.getClass().getSimpleName());
        }
    }

    /** Open the sealed vault key (call right after a fingerprint check). */
    @PluginMethod
    public void vaultOpen(PluginCall call) {
        String sealed = call.getString("sealed");
        if (sealed == null) {
            call.reject("sealed is required");
            return;
        }
        try {
            JSObject ret = new JSObject();
            ret.put("data", VaultKeystore.open(sealed));
            call.resolve(ret);
        } catch (android.security.keystore.KeyPermanentlyInvalidatedException e) {
            VaultKeystore.forget();
            call.reject("invalidated");
        } catch (Exception e) {
            call.reject("failed");
        }
    }

    @PluginMethod
    public void vaultForget(PluginCall call) {
        VaultKeystore.forget();
        call.resolve();
    }

    /** Block screenshots / screen recording / the recents preview while the vault is open. */
    @PluginMethod
    public void setSecureScreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("secure", false));
        android.app.Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }

    /** The phone's location now (for an expense added by hand). { location: {lat,lng,accuracy,at} | null }. */
    @PluginMethod
    public void getCurrentLocation(PluginCall call) {
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            JSObject ret = new JSObject();
            android.location.Location loc = NearbyPlaces.hasPermission(ctx) ? NearbyPlaces.currentLocation(ctx, 6000) : null;
            try {
                ret.put("location", loc != null ? JSObject.fromJSONObject(NearbyPlaces.locationJson(loc)) : null);
            } catch (Exception e) {
                ret.put("location", null);
            }
            call.resolve(ret);
        }, "artha-current-location").start();
    }

    /** Teach the alert: at this spot the user paid `name` (picked on the expense screen). */
    @PluginMethod
    public void rememberPlace(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        String name = call.getString("name");
        if (lat == null || lng == null || name == null) {
            call.reject("lat, lng and name are required");
            return;
        }
        NearbyPlaces.rememberPlace(getContext(), lat, lng, name, call.getString("categoryId"));
        call.resolve();
    }

    /** The shop remembered at this spot (paid here before): { name, categoryId } or { name: null }. */
    @PluginMethod
    public void recallPlace(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        JSObject ret = new JSObject();
        if (lat == null || lng == null) {
            ret.put("name", null);
            call.resolve(ret);
            return;
        }
        android.location.Location loc = new android.location.Location("artha");
        loc.setLatitude(lat);
        loc.setLongitude(lng);
        Double acc = call.getDouble("accuracy");
        if (acc != null) loc.setAccuracy(acc.floatValue());
        NearbyPlaces.Remembered r = NearbyPlaces.recall(getContext(), loc);
        ret.put("name", r != null ? r.name : null);
        ret.put("categoryId", r != null ? r.categoryId : null);
        call.resolve(ret);
    }

    /** Named shops around a saved location (OpenStreetMap, or Google Places with the saved key). */
    @PluginMethod
    public void findNearbyPlaces(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        if (lat == null || lng == null) {
            call.reject("lat and lng are required");
            return;
        }
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            android.location.Location loc = new android.location.Location("artha");
            loc.setLatitude(lat);
            loc.setLongitude(lng);
            com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
            for (NearbyPlaces.Place p : NearbyPlaces.findAround(ctx, loc, 10)) {
                JSObject o = new JSObject();
                o.put("name", p.name);
                o.put("kind", p.kind);
                o.put("distanceM", p.distanceM);
                arr.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("places", arr);
            call.resolve(ret);
        }, "artha-nearby-lookup").start();
    }

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", Build.VERSION.SDK_INT < 23
            || android.provider.Settings.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open Display over other apps settings");
        }
    }

    /**
     * Post the sample expense prompt the way a real bank SMS would. With
     * delaySeconds > 0 it fires later, so the user can lock the phone or leave
     * the app first and see the real lock-screen / background behaviour.
     */
    @PluginMethod
    public void testSmsPrompt(PluginCall call) {
        int delay = Math.max(0, call.getInt("delaySeconds", 0));
        final Context ctx = getContext().getApplicationContext();
        Runnable show = () -> SmsBackgroundReceiver.showTestPrompt(ctx);
        if (delay == 0) {
            show.run();
        } else {
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(show, delay * 1000L);
        }
        call.resolve();
    }

    /**
     * Open the system settings page where the user grants Full-screen
     * notifications for Artha (Android 14+ only). No-op on older OSes where
     * the permission is auto-granted.
     */
    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(android.provider.Settings
                .ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Fallback: generic app info screen.
            try {
                Intent fallback = new Intent(
                    android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("Could not open Full-screen notifications settings");
            }
        }
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
