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
    /** Sample prompt from Settings → Test lock-screen alert: nothing is saved. */
    static final String EXTRA_TEST = "artha_prompt_test";

    // Current choice; starts from what the receiver resolved, filled in by the chips.
    private String selectedCategory;
    private String selectedAccount;
    private String amountDisplay;
    private String merchant;
    private TextView primaryBtn;
    private FlowLayout categoryChips;
    private FlowLayout accountChips;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_sms_prompt);

        Intent src = getIntent();
        amountDisplay = src != null ? src.getStringExtra(EXTRA_AMOUNT_DISPLAY) : null;
        merchant = src != null ? src.getStringExtra(EXTRA_MERCHANT) : null;
        String category = src != null ? src.getStringExtra(EXTRA_CATEGORY) : null;
        String account = src != null ? src.getStringExtra(EXTRA_ACCOUNT) : null;
        boolean canAdd = src != null && src.getBooleanExtra(EXTRA_CAN_ADD, false);
        selectedCategory = TextUtils.isEmpty(category) ? null : category;
        selectedAccount = TextUtils.isEmpty(account) ? null : account;

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

        primaryBtn = findViewById(R.id.prompt_primary_btn);
        TextView secondaryBtn = findViewById(R.id.prompt_secondary_btn);
        TextView openLink = findViewById(R.id.prompt_open_link);
        categoryChips = findViewById(R.id.prompt_category_chips);
        accountChips = findViewById(R.id.prompt_account_chips);
        secondaryBtn.setOnClickListener(v -> onDismiss());
        openLink.setOnClickListener(v -> onReview());

        // Whatever is still unknown can be picked here, from the lists the app
        // last synced. Without a list for a missing part, fall back to review.
        org.json.JSONArray categories = SmsBackgroundReceiver.readArray(this, SmsBackgroundReceiver.KEY_CATEGORY_LIST);
        org.json.JSONArray accounts = SmsBackgroundReceiver.readArray(this, SmsBackgroundReceiver.KEY_ACCOUNT_LIST);
        boolean needCategory = selectedCategory == null;
        boolean needAccount = selectedAccount == null;
        boolean canPick = (!needCategory || categories.length() > 0) && (!needAccount || accounts.length() > 0);

        TextView metaView = findViewById(R.id.prompt_meta);
        String meta = buildMeta(selectedCategory, selectedAccount);
        if (!canAdd && !canPick) {
            if (needAccount && !needCategory) {
                meta = selectedCategory + " · pick the account in Artha";
            } else if (needCategory && !needAccount) {
                meta = selectedAccount + " · pick the category in Artha";
            }
        }
        if (!TextUtils.isEmpty(meta)) {
            metaView.setText(meta);
        } else {
            metaView.setVisibility(View.GONE);
        }

        if (canAdd || canPick) {
            primaryBtn.setOnClickListener(v -> {
                if (selectedCategory != null && selectedAccount != null) {
                    onApprove(amountDisplay, merchant, selectedCategory, selectedAccount);
                }
            });
            if (!canAdd) {
                showPickers(needCategory ? categories : null, needAccount ? accounts : null);
            }
            refreshPrimary();
        } else {
            // A silent Add could log it to the wrong bucket; open Artha to pick.
            primaryBtn.setText(R.string.prompt_review);
            primaryBtn.setOnClickListener(v -> onReview());
            openLink.setVisibility(View.GONE);
        }
    }

    /** Show chip pickers for the missing category and/or account (null = known). */
    private void showPickers(org.json.JSONArray categories, org.json.JSONArray accounts) {
        View pickers = findViewById(R.id.prompt_pickers);
        pickers.setVisibility(View.VISIBLE);
        // The pickers take the spare height; the amount block moves up.
        android.widget.LinearLayout.LayoutParams lp =
            (android.widget.LinearLayout.LayoutParams) pickers.getLayoutParams();
        lp.weight = 3;
        pickers.setLayoutParams(lp);
        findViewById(R.id.prompt_spacer_bottom).setVisibility(View.GONE);

        if (categories != null) {
            for (int i = 0; i < categories.length(); i++) {
                org.json.JSONObject c = categories.optJSONObject(i);
                if (c == null) continue;
                String name = c.optString("name", "");
                if (name.isEmpty()) continue;
                categoryChips.addView(makeChip(name, parseColor(c.optString("color", "")), true));
            }
        } else {
            findViewById(R.id.prompt_category_label).setVisibility(View.GONE);
            categoryChips.setVisibility(View.GONE);
        }
        if (accounts != null) {
            for (int i = 0; i < accounts.length(); i++) {
                String name = accounts.optString(i, "");
                if (name.isEmpty()) continue;
                accountChips.addView(makeChip(name, null, false));
            }
            if (categories == null) {
                ((android.widget.LinearLayout.LayoutParams) findViewById(R.id.prompt_account_label)
                    .getLayoutParams()).topMargin = 0;
            }
        } else {
            findViewById(R.id.prompt_account_label).setVisibility(View.GONE);
            accountChips.setVisibility(View.GONE);
        }
    }

    private TextView makeChip(String name, Integer dotColor, boolean isCategory) {
        float d = getResources().getDisplayMetrics().density;
        TextView chip = new TextView(this);
        chip.setText(name);
        chip.setTag(name);
        chip.setTextColor(getColor(R.color.prompt_text));
        chip.setTextSize(14);
        chip.setMaxLines(1);
        chip.setEllipsize(TextUtils.TruncateAt.END);
        chip.setGravity(android.view.Gravity.CENTER_VERTICAL);
        chip.setMinHeight(Math.round(40 * d));
        chip.setPadding(Math.round(14 * d), Math.round(8 * d), Math.round(16 * d), Math.round(8 * d));
        chip.setClickable(true);
        chip.setFocusable(true);
        if (dotColor != null) {
            android.graphics.drawable.GradientDrawable dot = new android.graphics.drawable.GradientDrawable();
            dot.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            dot.setColor(dotColor);
            int size = Math.round(10 * d);
            dot.setSize(size, size);
            chip.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null);
            chip.setCompoundDrawablePadding(Math.round(8 * d));
        }
        styleChip(chip, false);
        chip.setOnClickListener(v -> {
            if (isCategory) {
                selectedCategory = name;
                markSelected(categoryChips, name);
            } else {
                selectedAccount = name;
                markSelected(accountChips, name);
            }
            refreshPrimary();
        });
        return chip;
    }

    private void markSelected(FlowLayout group, String name) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            if (child instanceof TextView) {
                styleChip((TextView) child, name.equals(child.getTag()));
            }
        }
    }

    private void styleChip(TextView chip, boolean selected) {
        float d = getResources().getDisplayMetrics().density;
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setCornerRadius(999 * d);
        if (selected) {
            bg.setColor(getColor(R.color.prompt_approve));
            bg.setStroke(Math.round(1 * d), getColor(R.color.prompt_approve));
        } else {
            bg.setColor(Color.argb(0x1F, 0xFF, 0xFF, 0xFF));
            bg.setStroke(Math.round(1 * d), Color.argb(0x40, 0xFF, 0xFF, 0xFF));
        }
        chip.setBackground(new android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(Color.argb(0x40, 0xFF, 0xFF, 0xFF)), bg, null));
        chip.setTypeface(android.graphics.Typeface.create("sans-serif-medium",
            selected ? android.graphics.Typeface.BOLD : android.graphics.Typeface.NORMAL));
    }

    /** Primary button reflects the choice: enabled "Add to X" once both are set. */
    private void refreshPrimary() {
        boolean ready = selectedCategory != null && selectedAccount != null;
        primaryBtn.setEnabled(ready);
        primaryBtn.setAlpha(ready ? 1f : 0.45f);
        if (ready) {
            primaryBtn.setText("Add to " + selectedCategory);
        } else if (selectedCategory == null) {
            primaryBtn.setText("Pick a category to add");
        } else {
            primaryBtn.setText("Pick an account to add");
        }
    }

    private static Integer parseColor(String hex) {
        if (hex == null || hex.isEmpty()) return null;
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return null;
        }
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

        if (isTest()) {
            cancelNotification();
            Toast.makeText(this, "Test alert works — would add to " + category + ". Nothing was saved.",
                Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        enqueueApproved(body, address, date, amountDisplay, merchant, category, account);
        cancelNotification();
        clearPendingStash();
        Toast.makeText(this, R.string.prompt_added, Toast.LENGTH_SHORT).show();
        finish();
    }

    private boolean isTest() {
        Intent src = getIntent();
        return src != null && src.getBooleanExtra(EXTRA_TEST, false);
    }

    private void onDismiss() {
        cancelNotification();
        if (!isTest()) {
            clearPendingStash();
        }
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
            launch.putExtra(SmsBackgroundReceiver.EXTRA_OPEN_SMS, !isTest());
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
