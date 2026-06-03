package com.artha.app;

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

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        isForeground = false;
    }
}

