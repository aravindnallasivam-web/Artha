package com.artha.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen "Scan & Pay" button: opens Artha straight into the QR camera. */
public class ScanPayWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] ids) {
        Intent open = new Intent(ctx, MainActivity.class)
            .setAction("com.artha.app.SCAN_PAY")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(BillReminders.EXTRA_OPEN_ROUTE, "/pay");
        PendingIntent pi = PendingIntent.getActivity(ctx, 8801, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_scan_pay);
            views.setOnClickPendingIntent(R.id.widget_scan_pay, pi);
            manager.updateAppWidget(id, views);
        }
    }
}
