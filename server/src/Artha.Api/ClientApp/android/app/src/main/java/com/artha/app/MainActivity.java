package com.artha.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /**
     * Whether the app is currently in the foreground. The SMS receivers use this
     * to split responsibilities: in-app live popup when foreground, background
     * notification when not.
     */
    public static volatile boolean isForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * When the app is already running and the user taps the "expense detected"
     * notification, Android delivers the intent here. Keep getIntent() current
     * so SmsReaderPlugin.consumePendingSms() can see the launch extra.
     */
    @Override
    public void onNewIntent(Intent intent) {
        setIntent(intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        isForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        isForeground = false;
    }
}

