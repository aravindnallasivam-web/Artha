package com.artha.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.view.ViewGroup;

/**
 * Minimal wrapping row layout for the category / account chips on the
 * expense prompt: children flow left to right and wrap onto new lines, each
 * line centred. (No Material / Flexbox dependency in this app.)
 */
public class FlowLayout extends ViewGroup {

    private final int hGap;
    private final int vGap;

    public FlowLayout(Context context) {
        this(context, null);
    }

    public FlowLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
        float d = context.getResources().getDisplayMetrics().density;
        hGap = Math.round(8 * d);
        vGap = Math.round(10 * d);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int maxWidth = MeasureSpec.getSize(widthMeasureSpec) - getPaddingLeft() - getPaddingRight();
        int lineWidth = 0;
        int lineHeight = 0;
        int height = 0;
        int widest = 0;
        for (int i = 0; i < getChildCount(); i++) {
            View child = getChildAt(i);
            if (child.getVisibility() == GONE) continue;
            child.measure(MeasureSpec.makeMeasureSpec(maxWidth, MeasureSpec.AT_MOST),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
            int w = child.getMeasuredWidth();
            int h = child.getMeasuredHeight();
            if (lineWidth > 0 && lineWidth + hGap + w > maxWidth) {
                height += lineHeight + vGap;
                widest = Math.max(widest, lineWidth);
                lineWidth = 0;
                lineHeight = 0;
            }
            lineWidth += (lineWidth > 0 ? hGap : 0) + w;
            lineHeight = Math.max(lineHeight, h);
        }
        height += lineHeight;
        widest = Math.max(widest, lineWidth);
        int measuredWidth = MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.EXACTLY
            ? MeasureSpec.getSize(widthMeasureSpec)
            : widest + getPaddingLeft() + getPaddingRight();
        setMeasuredDimension(measuredWidth, height + getPaddingTop() + getPaddingBottom());
    }

    @Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        int maxWidth = r - l - getPaddingLeft() - getPaddingRight();
        int y = getPaddingTop();
        int start = 0;
        int count = getChildCount();
        while (start < count) {
            // Collect one line.
            int lineWidth = 0;
            int lineHeight = 0;
            int end = start;
            while (end < count) {
                View child = getChildAt(end);
                if (child.getVisibility() == GONE) {
                    end++;
                    continue;
                }
                int w = child.getMeasuredWidth();
                if (lineWidth > 0 && lineWidth + hGap + w > maxWidth) break;
                lineWidth += (lineWidth > 0 ? hGap : 0) + w;
                lineHeight = Math.max(lineHeight, child.getMeasuredHeight());
                end++;
            }
            int x = getPaddingLeft() + Math.max(0, (maxWidth - lineWidth) / 2);
            for (int i = start; i < end; i++) {
                View child = getChildAt(i);
                if (child.getVisibility() == GONE) continue;
                int w = child.getMeasuredWidth();
                int h = child.getMeasuredHeight();
                int top = y + (lineHeight - h) / 2;
                child.layout(x, top, x + w, top + h);
                x += w + hGap;
            }
            y += lineHeight + vGap;
            start = end;
        }
    }
}
