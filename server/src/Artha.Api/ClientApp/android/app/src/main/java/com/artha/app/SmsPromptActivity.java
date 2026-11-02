package com.artha.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/**
 * MyGate / NoBroker-style lock-screen takeover for a bank-SMS expense. Rendered
 * from {@link SmsBackgroundReceiver}'s full-screen intent so the user can
 * Approve or Dismiss WITHOUT unlocking first and WITHOUT booting the WebView.
 *
 * Approve writes a one-line entry into the pre-approved queue (SharedPreferences);
 * the Angular layer drains that on next organic app open and silently syncs to
 * Drive. Dismiss just cancels the notification + clears the pending-SMS stash.
 * Both finish() this Activity immediately — it never stays on screen.
 */
public class SmsPromptActivity extends AppCompatActivity {

    /** Pre-approved queue (JSON array of entries), consumed by Angular on resume. */
    static final String KEY_PRE_APPROVED = "pre_approved";

    static final String EXTRA_AMOUNT_DISPLAY = "artha_prompt_amount";
    static final String EXTRA_MERCHANT = "artha_prompt_merchant";
    static final String EXTRA_CATEGORY = "artha_prompt_category";
    static final String EXTRA_ACCOUNT = "artha_prompt_account";
    static final String EXTRA_BODY = "artha_prompt_body";
    static final String EXTRA_ADDRESS = "artha_prompt_address";
    static final String EXTRA_DATE = "artha_prompt_date";
    static final String EXTRA_CAN_ADD = "artha_prompt_can_add";
    static final String EXTRA_NOTIF_ID = "artha_prompt_notif_id";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_sms_prompt);

        Intent src = getIntent();
        String amountDisplay = src != null ? src.getStringExtra(EXTRA_AMOUNT_DISPLAY) : null;
        String merchant = src != null ? src.getStringExtra(EXTRA_MERCHANT) : null;
        String category = src != null ? src.getStringExtra(EXTRA_CATEGORY) : null;
        String account = src != null ? src.getStringExtra(EXTRA_ACCOUNT) : null;
        boolean canAdd = src != null && src.getBooleanExtra(EXTRA_CAN_ADD, false);

        TextView amountView = findViewById(R.id.prompt_amount);
        if (!TextUtils.isEmpty(amountDisplay)) {
            amountView.setText(amountDisplay);
        }

        TextView merchantView = findViewById(R.id.prompt_merchant);
        if (!TextUtils.isEmpty(merchant)) {
            merchantView.setText(merchant);
        } else {
            merchantView.setVisibility(View.GONE);
        }

        TextView metaView = findViewById(R.id.prompt_meta);
        String meta = buildMeta(category, account);
        if (!TextUtils.isEmpty(meta)) {
            metaView.setText(meta);
        } else {
            metaView.setVisibility(View.GONE);
        }

        LinearLayout approveGroup = findViewById(R.id.prompt_approve_group);
        LinearLayout dismissGroup = findViewById(R.id.prompt_dismiss_group);
        Button reviewBtn = findViewById(R.id.prompt_review_btn);
        TextView approveLabel = findViewById(R.id.prompt_approve_label);

        if (canAdd) {
            approveGroup.setVisibility(View.VISIBLE);
            dismissGroup.setVisibility(View.VISIBLE);
            reviewBtn.setVisibility(View.GONE);
            if (!TextUtils.isEmpty(category)) {
                approveLabel.setText(getString(R.string.prompt_approve) + " · " + category);
            }
        } else {
            // Mappings unknown: hide the Approve/Dismiss pair and show the
            // single CTA that opens the app for review. The user hasn't told us
            // what account or category this message maps to yet, so a silent
            // Approve could log it to the wrong bucket.
            approveGroup.setVisibility(View.GONE);
            dismissGroup.setVisibility(View.GONE);
            reviewBtn.setVisibility(View.VISIBLE);
        }

        // Approve: enqueue + toast + finish, never boots the WebView.
        ImageButton approveBtn = findViewById(R.id.prompt_approve_btn);
        approveBtn.setOnClickListener(v -> onApprove(amountDisplay, merchant, category, account));

        // Dismiss: silent, mirrors swipe-to-dismiss.
        ImageButton dismissBtn = findViewById(R.id.prompt_dismiss_btn);
        dismissBtn.setOnClickListener(v -> onDismiss());

        reviewBtn.setOnClickListener(v -> onReview());

        // "Open Artha to edit" link always opens the app so the user can
        // tweak account / category / note before saving.
        TextView openLink = findViewById(R.id.prompt_open_link);
        openLink.setOnClickListener(v -> onReview());
    }

    /**
     * Enable the show-over-lock-screen + turn-screen-on bits BEFORE
     * setContentView, so the Activity renders directly on top of the keyguard
     * without the user unlocking first — the MyGate / NoBroker approval
     * pattern. On API 27+ we use the typed setters; older OSes fall back to
     * the window flags.
     */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            // Secure keyguard still shows the Activity above the lock screen;
            // a swipe up to unlock surfaces the PIN before any dismiss. The
            // KeyguardManager.requestDismissKeyguard call is intentionally
            // skipped — the whole point is to NOT force an unlock.
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }

        // Draw into the system bars so the gradient background bleeds edge-to-
        // edge instead of leaving a strip of grey at the top. The layout keeps
        // its content clear of the status bar via fitsSystemWindows.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
    }

    private String buildMeta(String category, String account) {
        boolean hasCategory = !TextUtils.isEmpty(category);
        boolean hasAccount = !TextUtils.isEmpty(account);
        if (hasCategory && hasAccount) {
            return category + " · " + account;
        }
        if (hasCategory) {
            return category;
        }
        if (hasAccount) {
            return account;
        }
        return null;
    }

    private void onApprove(String amountDisplay, String merchant, String category, String account) {
        Intent src = getIntent();
        String body = src != null ? src.getStringExtra(EXTRA_BODY) : null;
        String address = src != null ? src.getStringExtra(EXTRA_ADDRESS) : null;
        long date = src != null ? src.getLongExtra(EXTRA_DATE, System.currentTimeMillis())
                                : System.currentTimeMillis();

        enqueueApproved(body, address, date, amountDisplay, merchant, category, account);
        cancelNotification();
        clearPendingStash();
        Toast.makeText(this, R.string.prompt_added, Toast.LENGTH_SHORT).show();
        finish();
    }

    private void onDismiss() {
        cancelNotification();
        clearPendingStash();
        Toast.makeText(this, R.string.prompt_dismissed, Toast.LENGTH_SHORT).show();
        finish();
    }

    /**
     * Launch MainActivity with the open-SMS flag so the WebView opens the
     * confirm dialog from the stash SmsBackgroundReceiver already wrote.
     */
    private void onReview() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            launch.putExtra(SmsBackgroundReceiver.EXTRA_OPEN_SMS, true);
            startActivity(launch);
        }
        cancelNotification();
        finish();
    }

    /**
     * Append a JSON entry to the pre-approved queue. Angular drains this on the
     * next app resume and quietly syncs each entry to Drive, so the user never
     * sees the confirm dialog for it.
     */
    private void enqueueApproved(String body, String address, long date,
                                 String amountDisplay, String merchant,
                                 String category, String account) {
        android.content.SharedPreferences prefs =
            getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_PRE_APPROVED, "[]");
        org.json.JSONArray arr;
        try {
            arr = new org.json.JSONArray(raw);
        } catch (org.json.JSONException e) {
            arr = new org.json.JSONArray();
        }
        try {
            org.json.JSONObject entry = new org.json.JSONObject();
            entry.put("address", address != null ? address : "");
            entry.put("body", body != null ? body : "");
            entry.put("date", date);
            entry.put("amountDisplay", amountDisplay != null ? amountDisplay : "");
            entry.put("merchant", merchant != null ? merchant : "");
            entry.put("category", category != null ? category : "");
            entry.put("account", account != null ? account : "");
            entry.put("approvedAt", System.currentTimeMillis());
            arr.put(entry);
            prefs.edit().putString(KEY_PRE_APPROVED, arr.toString()).apply();
        } catch (org.json.JSONException ignored) {
        }
    }

    private void cancelNotification() {
        int notifId = getIntent() != null
            ? getIntent().getIntExtra(EXTRA_NOTIF_ID, -1)
            : -1;
        if (notifId > 0) {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(notifId);
            }
        }
    }

    private void clearPendingStash() {
        getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(SmsBackgroundReceiver.KEY_PENDING_BODY)
            .remove(SmsBackgroundReceiver.KEY_PENDING_ADDRESS)
            .remove(SmsBackgroundReceiver.KEY_PENDING_DATE)
            .apply();
    }
}
