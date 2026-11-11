package com.artha.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Full-screen prompt for bank-SMS expenses, shown over the lock screen or other
 * apps. Walks through {@link PromptQueue}: every SMS that arrives while it is
 * up is added to the queue, the header shows "1 of 3", and Add / Dismiss move
 * on to the next one. When the category or account isn't learned yet, chips
 * let the user pick them here. Never boots the WebView: Add writes to the
 * pre-approved queue (SharedPreferences) that the app logs on its next open.
 */
public class SmsPromptActivity extends AppCompatActivity {

    /** Pre-approved queue (JSON array of entries), consumed by Angular on resume. */
    static final String KEY_PRE_APPROVED = "pre_approved";

    // Launch extras. The prompt reads its SMS from PromptQueue; these extras are
    // the fallback for an intent that arrives with an empty queue.
    static final String EXTRA_AMOUNT_DISPLAY = "artha_prompt_amount";
    static final String EXTRA_MERCHANT = "artha_prompt_merchant";
    static final String EXTRA_CATEGORY = "artha_prompt_category";
    static final String EXTRA_ACCOUNT = "artha_prompt_account";
    static final String EXTRA_BODY = "artha_prompt_body";
    static final String EXTRA_ADDRESS = "artha_prompt_address";
    static final String EXTRA_DATE = "artha_prompt_date";
    static final String EXTRA_CAN_ADD = "artha_prompt_can_add";
    static final String EXTRA_NOTIF_ID = "artha_prompt_notif_id";
    /** Sample prompt from Settings → Test expense alert: nothing is saved. */
    static final String EXTRA_TEST = "artha_prompt_test";

    // The SMS on screen and the user's choice for it.
    private String amountDisplay;
    private String merchant;
    private String body;
    private String address;
    private long date;
    private boolean test;
    private boolean fromQueue;
    private String selectedCategory;
    private String selectedAccount;

    private TextView counterView;
    private TextView amountView;
    private TextView merchantView;
    private TextView metaView;
    private TextView primaryBtn;
    private TextView openLink;
    private View pickers;
    private View spacerBottom;
    private TextView categoryLabel;
    private TextView accountLabel;
    private FlowLayout categoryChips;
    private FlowLayout accountChips;
    private TextView aiStatus;
    private TextView nearbyLabel;
    private FlowLayout nearbyChips;
    /** Shop the user picked from "Nearby"; saved as the expense's note. */
    private String placeName;
    private TextView subLabel;
    private FlowLayout subChips;
    /** The group whose subcategories the chips show in place of the groups; null = groups. */
    private Cat drilledGroup;
    /** A group the AI picked, listed first among the groups. */
    private String frontGroupId;
    /** Id of the picked category (a subcategory when one was chosen); null when known by name only. */
    private String selectedCategoryId;
    /** Categories synced from the app, by id; subcategories carry their parent's id. */
    private final java.util.Map<String, Cat> catById = new java.util.LinkedHashMap<>();

    private static final class Cat {
        final String id;
        final String name;
        final String parentId;
        final Integer color;
        final List<Cat> children = new ArrayList<>();

        Cat(String id, String name, String parentId, Integer color) {
            this.id = id;
            this.name = name;
            this.parentId = parentId;
            this.color = color;
        }

        /** "Transport › Fuel" for a subcategory, as the AI sees it. */
        String path(java.util.Map<String, Cat> byId) {
            Cat parent = parentId != null ? byId.get(parentId) : null;
            return parent != null ? parent.name + " \u203a " + name : name;
        }
    }
    /** Bumped on every render so a late AI answer for a previous SMS is ignored. */
    private int renderSeq;
    /** The user tapped a chip: an AI answer arriving later won't override it. */
    private boolean userPicked;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_sms_prompt);

        counterView = findViewById(R.id.prompt_counter);
        amountView = findViewById(R.id.prompt_amount);
        merchantView = findViewById(R.id.prompt_merchant);
        metaView = findViewById(R.id.prompt_meta);
        primaryBtn = findViewById(R.id.prompt_primary_btn);
        openLink = findViewById(R.id.prompt_open_link);
        pickers = findViewById(R.id.prompt_pickers);
        spacerBottom = findViewById(R.id.prompt_spacer_bottom);
        categoryLabel = findViewById(R.id.prompt_category_label);
        accountLabel = findViewById(R.id.prompt_account_label);
        categoryChips = findViewById(R.id.prompt_category_chips);
        accountChips = findViewById(R.id.prompt_account_chips);
        aiStatus = findViewById(R.id.prompt_ai_status);
        nearbyLabel = findViewById(R.id.prompt_nearby_label);
        nearbyChips = findViewById(R.id.prompt_nearby_chips);
        subLabel = findViewById(R.id.prompt_sub_label);
        subChips = findViewById(R.id.prompt_sub_chips);

        TextView secondaryBtn = findViewById(R.id.prompt_secondary_btn);
        secondaryBtn.setOnClickListener(v -> onDismiss());
        openLink.setOnClickListener(v -> onReview());
        primaryBtn.setOnClickListener(v -> onPrimary());

        if (!showNext()) {
            finish();
        }
    }

    /** Another SMS arrived while this is on screen: it's queued, just update "1 of N". */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (fromQueue) {
            updateCounter();
        } else {
            showNext();
        }
    }

    /** Show the oldest waiting SMS. False when there's nothing to show. */
    private boolean showNext() {
        return showNext(true);
    }

    /**
     * @param fromIntent fall back to the launching intent's SMS when nothing is
     *     queued; false after Add / Dismiss, so the SMS just handled never reappears.
     */
    private boolean showNext(boolean fromIntent) {
        JSONObject entry = PromptQueue.first(this);
        String category;
        String account;
        if (entry != null) {
            fromQueue = true;
            amountDisplay = entry.optString(PromptQueue.F_AMOUNT, "");
            merchant = nullIfEmpty(entry.optString(PromptQueue.F_MERCHANT, ""));
            category = nullIfEmpty(entry.optString(PromptQueue.F_CATEGORY, ""));
            account = nullIfEmpty(entry.optString(PromptQueue.F_ACCOUNT, ""));
            body = entry.optString(PromptQueue.F_BODY, "");
            address = entry.optString(PromptQueue.F_ADDRESS, "");
            date = entry.optLong(PromptQueue.F_DATE, System.currentTimeMillis());
            test = entry.optBoolean(PromptQueue.F_TEST, false);
        } else {
            Intent src = getIntent();
            if (!fromIntent || src == null || !src.hasExtra(EXTRA_AMOUNT_DISPLAY)) {
                return false;
            }
            // Nothing waiting: a second launch for an SMS that was already added
            // or dismissed (late full-screen intent, duplicate broadcast) shows nothing.
            if (!src.getBooleanExtra(EXTRA_TEST, false)
                && PromptQueue.isResolved(this, src.getStringExtra(EXTRA_BODY), src.getStringExtra(EXTRA_ADDRESS))) {
                return false;
            }
            fromQueue = false;
            amountDisplay = src.getStringExtra(EXTRA_AMOUNT_DISPLAY);
            merchant = nullIfEmpty(src.getStringExtra(EXTRA_MERCHANT));
            category = nullIfEmpty(src.getStringExtra(EXTRA_CATEGORY));
            account = nullIfEmpty(src.getStringExtra(EXTRA_ACCOUNT));
            body = src.getStringExtra(EXTRA_BODY);
            address = src.getStringExtra(EXTRA_ADDRESS);
            date = src.getLongExtra(EXTRA_DATE, System.currentTimeMillis());
            test = src.getBooleanExtra(EXTRA_TEST, false);
        }
        render(category, account);
        updateCounter();
        return true;
    }

    private void updateCounter() {
        int waiting = fromQueue ? PromptQueue.size(this) : 1;
        if (waiting > 1) {
            counterView.setText("1 of " + waiting);
            counterView.setVisibility(View.VISIBLE);
        } else {
            counterView.setVisibility(View.GONE);
        }
    }

    private void render(String category, String account) {
        selectedCategory = category;
        selectedCategoryId = null;
        selectedAccount = account;
        renderSeq++;
        userPicked = false;
        placeName = null;
        aiStatus.setVisibility(View.GONE);
        nearbyLabel.setVisibility(View.GONE);
        nearbyChips.removeAllViews();
        nearbyChips.setVisibility(View.GONE);

        amountView.setText(TextUtils.isEmpty(amountDisplay) ? "₹0" : amountDisplay);
        amountView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 64);
        if (!TextUtils.isEmpty(merchant)) {
            merchantView.setText(merchant);
            merchantView.setVisibility(View.VISIBLE);
        } else {
            merchantView.setVisibility(View.GONE);
        }

        // Reset the pickers from the previous SMS.
        categoryChips.removeAllViews();
        accountChips.removeAllViews();
        hideSubs();
        pickers.setVisibility(View.GONE);
        setPickerWeight(0);
        spacerBottom.setVisibility(View.VISIBLE);
        pickers.scrollTo(0, 0);

        boolean canAdd = category != null && account != null;
        // Whatever is still unknown can be picked here, from the lists the app
        // last synced. Without a list for a missing part, fall back to review.
        JSONArray categories = SmsBackgroundReceiver.readArray(this, SmsBackgroundReceiver.KEY_CATEGORY_LIST);
        JSONArray accounts = SmsBackgroundReceiver.readArray(this, SmsBackgroundReceiver.KEY_ACCOUNT_LIST);
        boolean needCategory = category == null;
        boolean needAccount = account == null;
        boolean canPick = (!needCategory || categories.length() > 0) && (!needAccount || accounts.length() > 0);

        String meta = buildMeta(category, account);
        if (!canAdd && !canPick) {
            if (needAccount && !needCategory) {
                meta = category + " · pick the account in Artha";
            } else if (needCategory && !needAccount) {
                meta = account + " · pick the category in Artha";
            }
        }
        if (!TextUtils.isEmpty(meta)) {
            metaView.setText(meta);
            metaView.setVisibility(View.VISIBLE);
        } else {
            metaView.setVisibility(View.GONE);
        }

        if (canAdd || canPick) {
            openLink.setVisibility(View.VISIBLE);
            if (!canAdd) {
                showPickers(needCategory ? categories : null, needAccount ? accounts : null);
                if ((test || unknownShop(merchant)) && NearbyPlaces.isEnabled(this)) {
                    askNearby(needCategory);
                }
                if (AiClient.isConfigured(this)) {
                    askAi(categoryPaths(), names(accounts, false), needCategory, needAccount);
                }
            }
            refreshPrimary();
        } else {
            // A silent Add could log it to the wrong bucket; open Artha to pick.
            primaryBtn.setEnabled(true);
            primaryBtn.setAlpha(1f);
            primaryBtn.setText(R.string.prompt_review);
            openLink.setVisibility(View.GONE);
        }
    }

    private void onPrimary() {
        if (selectedCategory != null && selectedAccount != null) {
            onApprove();
        } else if (!pickers.isShown()) {
            onReview();
        }
    }

    /** Show chip pickers for the missing category and/or account (null = known). */
    private void showPickers(JSONArray categories, JSONArray accounts) {
        pickers.setVisibility(View.VISIBLE);
        // The pickers take the spare height; the amount block moves up.
        setPickerWeight(3);
        spacerBottom.setVisibility(View.GONE);

        boolean showCategories = categories != null;
        categoryLabel.setVisibility(showCategories ? View.VISIBLE : View.GONE);
        categoryChips.setVisibility(showCategories ? View.VISIBLE : View.GONE);
        catById.clear();
        drilledGroup = null;
        frontGroupId = null;
        if (showCategories) {
            loadCategories(categories);
            renderCategoryChips();
        }
        // A smaller amount leaves the pickers room to fit without scrolling.
        amountView.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 48);

        boolean showAccounts = accounts != null;
        accountLabel.setVisibility(showAccounts ? View.VISIBLE : View.GONE);
        accountChips.setVisibility(showAccounts ? View.VISIBLE : View.GONE);
        ((LinearLayout.LayoutParams) accountLabel.getLayoutParams()).topMargin =
            showCategories ? dp(20) : 0;
        if (showAccounts) {
            for (int i = 0; i < accounts.length(); i++) {
                String name = accounts.optString(i, "");
                if (name.isEmpty()) continue;
                accountChips.addView(makeChip(name, null, false));
            }
        }
    }

    private void setPickerWeight(float weight) {
        LinearLayout.LayoutParams lp = (LinearLayout.LayoutParams) pickers.getLayoutParams();
        lp.weight = weight;
        pickers.setLayoutParams(lp);
    }

    /** Synced categories (most used first). Older app builds send no ids: names stand in. */
    private void loadCategories(JSONArray list) {
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null) continue;
            String name = o.optString("name", "");
            if (name.isEmpty()) continue;
            String id = o.optString("id", "");
            String parentId = o.optString("parentId", "");
            catById.put(id.isEmpty() ? name : id, new Cat(id.isEmpty() ? name : id, name,
                parentId.isEmpty() || "null".equals(parentId) ? null : parentId, parseColor(o.optString("color", ""))));
        }
        // Link subcategories; one whose parent is missing (archived) is shown as top-level.
        List<Cat> orphans = new ArrayList<>();
        for (Cat c : catById.values()) {
            if (c.parentId == null) continue;
            Cat parent = catById.get(c.parentId);
            if (parent != null && parent.parentId == null) {
                parent.children.add(c);
            } else {
                orphans.add(c);
            }
        }
        for (Cat o : orphans) {
            catById.put(o.id, new Cat(o.id, o.name, null, o.color));
        }
    }

    /** Every category as the AI sees it ("Transport › Fuel"), same order as catById. */
    private List<String> categoryPaths() {
        List<String> out = new ArrayList<>();
        for (Cat c : catById.values()) {
            out.add(c.path(catById));
        }
        return out;
    }

    private Cat catByPath(String path) {
        if (path == null) return null;
        for (Cat c : catById.values()) {
            if (path.equals(c.path(catById))) return c;
        }
        return null;
    }

    private TextView makeCategoryChip(Cat c, boolean isSub) {
        // "›" marks a group that opens its subcategories in place.
        String label = !isSub && !c.children.isEmpty() ? c.name + "  \u203a" : c.name;
        TextView chip = makeChip(label, isSub ? null : c.color, true);
        chip.setTag(c.id);
        chip.setOnClickListener(v -> {
            userPicked = true;
            selectCategory(c);
        });
        return chip;
    }

    /**
     * The category chips: the groups, or (drilled into a group) a back chip,
     * "Just <group>" and the group's subcategories, in the same spot, so a
     * subcategory is one tap away without scrolling.
     */
    private void renderCategoryChips() {
        categoryChips.removeAllViews();
        hideSubs();
        Cat group = drilledGroup;
        if (group == null) {
            categoryLabel.setText("Pick a category");
            List<Cat> tops = new ArrayList<>();
            for (Cat c : catById.values()) {
                if (c.parentId == null) tops.add(c);
            }
            if (frontGroupId != null) {
                for (int i = 0; i < tops.size(); i++) {
                    if (tops.get(i).id.equals(frontGroupId)) {
                        tops.add(0, tops.remove(i));
                        break;
                    }
                }
            }
            for (Cat c : tops) {
                categoryChips.addView(makeCategoryChip(c, false));
            }
            Cat sel = selectedCategoryId != null ? catById.get(selectedCategoryId) : null;
            String topId = sel == null ? null : (sel.parentId != null ? sel.parentId : sel.id);
            markSelected(categoryChips, topId);
        } else {
            categoryLabel.setText(group.name + " \u00b7 subcategory (optional)");
            TextView back = makeChip("\u2039  All categories", null, true);
            back.setTag("__back");
            back.setOnClickListener(v -> {
                drilledGroup = null;
                renderCategoryChips();
            });
            categoryChips.addView(back);
            TextView just = makeChip("Just " + group.name, group.color, true);
            just.setTag(group.id);
            just.setOnClickListener(v -> {
                userPicked = true;
                selectCategory(group);
            });
            categoryChips.addView(just);
            for (Cat child : group.children) {
                categoryChips.addView(makeCategoryChip(child, true));
            }
            markSelected(categoryChips, selectedCategoryId);
        }
        if (pickers instanceof android.widget.ScrollView) {
            pickers.post(() -> ((android.widget.ScrollView) pickers).smoothScrollTo(0, 0));
        }
    }

    /** Pick a category; a group with subcategories opens them in place, keeping the group selected. */
    private void selectCategory(Cat c) {
        selectedCategoryId = c.id;
        selectedCategory = c.name;
        Cat parent = c.parentId != null ? catById.get(c.parentId) : null;
        Cat group = parent != null ? parent : (!c.children.isEmpty() ? c : null);
        if (group != drilledGroup) {
            drilledGroup = group;
            renderCategoryChips();
        } else {
            markSelected(categoryChips, c.id);
        }
        refreshPrimary();
    }

    /** "Food › Café" for a subcategory, else the name. */
    private String selectedLabel() {
        Cat c = selectedCategoryId != null ? catById.get(selectedCategoryId) : null;
        Cat parent = c != null && c.parentId != null ? catById.get(c.parentId) : null;
        return parent != null ? parent.name + " \u203a " + c.name : selectedCategory;
    }

    private void hideSubs() {
        subChips.removeAllViews();
        subChips.setTag(null);
        subLabel.setVisibility(View.GONE);
        subChips.setVisibility(View.GONE);
    }

    private TextView makeChip(String name, Integer dotColor, boolean isCategory) {
        TextView chip = new TextView(this);
        chip.setText(name);
        chip.setTag(name);
        chip.setTextColor(getColor(R.color.prompt_text));
        chip.setTextSize(14);
        chip.setMaxLines(1);
        chip.setEllipsize(TextUtils.TruncateAt.END);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        chip.setMinHeight(dp(40));
        chip.setPadding(dp(14), dp(8), dp(16), dp(8));
        chip.setClickable(true);
        chip.setFocusable(true);
        if (dotColor != null) {
            GradientDrawable dot = new GradientDrawable();
            dot.setShape(GradientDrawable.OVAL);
            dot.setColor(dotColor);
            dot.setSize(dp(10), dp(10));
            chip.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null);
            chip.setCompoundDrawablePadding(dp(8));
        }
        styleChip(chip, false);
        chip.setOnClickListener(v -> {
            userPicked = true;
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

    /** No shop name in the SMS: none found, or a phone number / UPI id instead of a name. */
    private static boolean unknownShop(String m) {
        return m == null || m.trim().isEmpty() || m.replaceAll("[^0-9]", "").length() >= 6;
    }

    /** Look up named shops around the user and offer them as chips. */
    private void askNearby(boolean needCategory) {
        final int seq = renderSeq;
        nearbyLabel.setText("\uD83D\uDCCD Finding shops near you\u2026");
        nearbyLabel.setVisibility(View.VISIBLE);
        new Thread(() -> {
            List<NearbyPlaces.Place> places = NearbyPlaces.find(getApplicationContext(), 6);
            runOnUiThread(() -> showNearby(seq, places, needCategory));
        }, "artha-nearby").start();
    }

    private void showNearby(int seq, List<NearbyPlaces.Place> places, boolean needCategory) {
        if (isFinishing() || isDestroyed() || seq != renderSeq) return;
        if (places.isEmpty()) {
            nearbyLabel.setVisibility(View.GONE);
            return;
        }
        nearbyLabel.setText("\uD83D\uDCCD Nearby \u00b7 tap the shop you paid");
        nearbyChips.removeAllViews();
        for (NearbyPlaces.Place p : places) {
            TextView chip = makeChip(p.name + "  \u00b7 " + p.distanceM + " m", null, false);
            chip.setTag(p.name);
            chip.setOnClickListener(v -> pickPlace(p, needCategory));
            nearbyChips.addView(chip);
        }
        nearbyChips.setVisibility(View.VISIBLE);
    }

    /** Use a nearby shop: its name becomes the note, its type picks a matching category. */
    private void pickPlace(NearbyPlaces.Place p, boolean needCategory) {
        placeName = p.name;
        merchant = p.name;
        merchantView.setText(p.name);
        merchantView.setVisibility(View.VISIBLE);
        markSelected(nearbyChips, p.name);
        if (needCategory) {
            Cat c = catByHint(p.hint);
            if (c != null) {
                userPicked = true;
                selectCategory(c);
            }
        }
        refreshPrimary();
    }

    /** The first category (subcategories first) whose name contains a hint word. */
    private Cat catByHint(String[] hints) {
        for (String h : hints) {
            String w = h.toLowerCase(java.util.Locale.ROOT);
            Cat top = null;
            for (Cat c : catById.values()) {
                if (!c.name.toLowerCase(java.util.Locale.ROOT).contains(w)) continue;
                if (c.parentId != null) return c;
                if (top == null) top = c;
            }
            if (top != null) return top;
        }
        return null;
    }

    /**
     * Ask the AI provider for the missing category / account on a worker
     * thread, then pre-select its picks (moved to the front of the chips).
     * The user can still pick another chip; nothing is added until they tap Add.
     */
    private void askAi(List<String> categoryNames, List<String> accountNames,
                       boolean needCategory, boolean needAccount) {
        final int seq = renderSeq;
        final String smsBody = body;
        final String smsAddress = address != null ? address : "";
        final double amount = parseAmount(amountDisplay);
        final String isoDate = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
            .format(new java.util.Date(date));
        aiStatus.setText("\u2728 Asking AI\u2026");
        aiStatus.setVisibility(View.VISIBLE);
        new Thread(() -> {
            AiClient.Suggestion s = AiClient.classify(getApplicationContext(), smsAddress, smsBody, amount,
                isoDate, categoryNames, accountNames, 8000);
            runOnUiThread(() -> applyAi(seq, s, needCategory, needAccount));
        }, "artha-ai").start();
    }

    private void applyAi(int seq, AiClient.Suggestion s, boolean needCategory, boolean needAccount) {
        if (isFinishing() || isDestroyed() || seq != renderSeq) {
            return;
        }
        boolean applied = false;
        if (s != null && !userPicked) {
            Cat picked = needCategory && selectedCategory == null ? catByPath(s.category) : null;
            if (picked != null) {
                Cat top = picked.parentId != null ? catById.get(picked.parentId) : picked;
                if (top != null) frontGroupId = top.id;
                selectCategory(picked);
                if (drilledGroup == null) renderCategoryChips(); // show the AI's group first
                applied = true;
            }
            if (needAccount && s.account != null && selectedAccount == null) {
                selectedAccount = s.account;
                moveToFront(accountChips, s.account);
                markSelected(accountChips, s.account);
                applied = true;
            }
            if (applied) {
                refreshPrimary();
            }
        }
        if (applied) {
            aiStatus.setText("\u2728 AI picked \u00b7 tap another to change");
        } else if (userPicked) {
            aiStatus.setVisibility(View.GONE);
        } else {
            aiStatus.setText("AI wasn't sure \u00b7 pick one below");
        }
    }

    private static void moveToFront(FlowLayout group, String name) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            if (name.equals(child.getTag())) {
                group.removeViewAt(i);
                group.addView(child, 0);
                return;
            }
        }
    }

    /** Names from the synced lists (categories are {name, color} objects). */
    private static List<String> names(JSONArray list, boolean objects) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < list.length(); i++) {
            String name = objects
                ? (list.optJSONObject(i) != null ? list.optJSONObject(i).optString("name", "") : "")
                : list.optString(i, "");
            if (!name.isEmpty()) out.add(name);
        }
        return out;
    }

    private static double parseAmount(String display) {
        if (display == null) return 0;
        String digits = display.replaceAll("[^0-9.]", "");
        try {
            return digits.isEmpty() ? 0 : Double.parseDouble(digits);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void markSelected(FlowLayout group, String name) {
        for (int i = 0; i < group.getChildCount(); i++) {
            View child = group.getChildAt(i);
            if (child instanceof TextView) {
                styleChip((TextView) child, name != null && name.equals(child.getTag()));
            }
        }
    }

    private void styleChip(TextView chip, boolean selected) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(999));
        if (selected) {
            bg.setColor(getColor(R.color.prompt_approve));
            bg.setStroke(dp(1), getColor(R.color.prompt_approve));
        } else {
            bg.setColor(Color.argb(0x1F, 0xFF, 0xFF, 0xFF));
            bg.setStroke(dp(1), Color.argb(0x40, 0xFF, 0xFF, 0xFF));
        }
        chip.setBackground(new RippleDrawable(
            ColorStateList.valueOf(Color.argb(0x40, 0xFF, 0xFF, 0xFF)), bg, null));
        chip.setTypeface(Typeface.create("sans-serif-medium",
            selected ? Typeface.BOLD : Typeface.NORMAL));
    }

    /** Primary button reflects the choice: enabled "Add to X" once both are set. */
    private void refreshPrimary() {
        boolean ready = selectedCategory != null && selectedAccount != null;
        primaryBtn.setEnabled(ready);
        primaryBtn.setAlpha(ready ? 1f : 0.45f);
        if (ready) {
            primaryBtn.setText("Add to " + selectedLabel());
        } else if (selectedCategory == null) {
            primaryBtn.setText("Pick a category to add");
        } else {
            primaryBtn.setText("Pick an account to add");
        }
    }

    private void onApprove() {
        if (test) {
            Toast.makeText(this, "Test alert works — would add to " + selectedCategory
                + ". Nothing was saved.", Toast.LENGTH_LONG).show();
        } else {
            enqueueApproved(body, address, date, amountDisplay, merchant, selectedCategory, selectedAccount,
                selectedCategoryId);
            Toast.makeText(this, R.string.prompt_added, Toast.LENGTH_SHORT).show();
        }
        advance();
    }

    private void onDismiss() {
        Toast.makeText(this, R.string.prompt_dismissed, Toast.LENGTH_SHORT).show();
        advance();
    }

    /** Done with the SMS on screen: show the next waiting one, or close. */
    private void advance() {
        if (!fromQueue && !test) {
            PromptQueue.markResolved(this, body, address);
        }
        if (fromQueue) {
            PromptQueue.removeFirst(this);
            if (showNext(false)) {
                return;
            }
        }
        cancelNotification();
        if (!test) {
            clearPendingStash();
        }
        finish();
    }

    /**
     * Open Artha on the SMS on screen. The rest of the queue is left to the
     * app, whose scan lists them under Pending expenses.
     */
    private void onReview() {
        if (!test && body != null && !body.isEmpty()) {
            // Point the app's "opened from the alert" fast path at this SMS.
            getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(SmsBackgroundReceiver.KEY_PENDING_BODY, body)
                .putString(SmsBackgroundReceiver.KEY_PENDING_ADDRESS, address)
                .putLong(SmsBackgroundReceiver.KEY_PENDING_DATE, date)
                .apply();
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            launch.putExtra(SmsBackgroundReceiver.EXTRA_OPEN_SMS, !test);
            startActivity(launch);
        }
        PromptQueue.clear(this);
        cancelNotification();
        finish();
    }

    /**
     * Show over the keyguard and turn the screen on, before setContentView, so
     * the prompt appears without unlocking first.
     */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        // Draw into the system bars so the gradient reaches the screen edges.
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

    /**
     * Append a JSON entry to the pre-approved queue. Angular drains this on the
     * next app resume and quietly syncs each entry to Drive.
     */
    private void enqueueApproved(String body, String address, long date,
                                 String amountDisplay, String merchant,
                                 String category, String account, String categoryId) {
        android.content.SharedPreferences prefs =
            getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_PRE_APPROVED, "[]");
        JSONArray arr;
        try {
            arr = new JSONArray(raw);
        } catch (JSONException e) {
            arr = new JSONArray();
        }
        try {
            JSONObject entry = new JSONObject();
            entry.put("address", address != null ? address : "");
            entry.put("body", body != null ? body : "");
            entry.put("date", date);
            entry.put("amountDisplay", amountDisplay != null ? amountDisplay : "");
            entry.put("merchant", merchant != null ? merchant : "");
            entry.put("category", category != null ? category : "");
            // Shop picked from "Nearby": the app uses it as the note and remembers it.
            entry.put("placeName", placeName != null ? placeName : "");
            // Exact id when picked here, so same-named subcategories can't be confused.
            entry.put("categoryId", categoryId != null && catById.containsKey(categoryId) ? categoryId : "");
            entry.put("account", account != null ? account : "");
            entry.put("approvedAt", System.currentTimeMillis());
            arr.put(entry);
            prefs.edit().putString(KEY_PRE_APPROVED, arr.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    private void cancelNotification() {
        NotificationManager nm =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(SmsBackgroundReceiver.NOTIF_ID);
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String nullIfEmpty(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    private static Integer parseColor(String hex) {
        if (hex == null || hex.isEmpty()) return null;
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
