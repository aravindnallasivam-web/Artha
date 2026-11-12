package com.artha.app;

import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ExperimentalGetImage;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Point the camera at a card: the number, expiry and name are read on the
 * phone (ML Kit, no network) and handed back to the vault form. No image is
 * stored; the screen can't be captured. The CVV is never read.
 */
public class CardScanActivity extends AppCompatActivity {

    static final String EXTRA_NUMBER = "number";
    static final String EXTRA_EXPIRY = "expiry";
    static final String EXTRA_NAME = "name";

    /** After the number is read, how long to keep looking for the expiry / name. */
    private static final long EXTRA_LOOK_MS = 3500;

    private PreviewView previewView;
    private TextView hint;
    private TextView torchBtn;
    private Camera camera;
    private ExecutorService executor;
    private TextRecognizer recognizer;
    private boolean torchOn;
    private volatile boolean done;
    private volatile boolean busy;

    private String lastNumber;
    private int sameNumberHits;
    private String number;
    private String expiry;
    private String name;
    private long numberAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildLayout());
        executor = Executors.newSingleThreadExecutor();
        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        startCamera();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        done = true;
        if (executor != null) executor.shutdown();
        if (recognizer != null) recognizer.close();
    }

    private View buildLayout() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        previewView = new PreviewView(this);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(-1, -1));
        root.addView(new FrameOverlay(this), new FrameLayout.LayoutParams(-1, -1));

        TextView title = new TextView(this);
        title.setText("Scan card");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
        FrameLayout.LayoutParams tp = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        tp.topMargin = dp(48);
        root.addView(title, tp);

        hint = new TextView(this);
        hint.setText("Fit the card in the frame, on a plain surface with good light");
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(24), 0, dp(24), 0);
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        hp.bottomMargin = dp(140);
        root.addView(hint, hp);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        TextView cancel = pill("Cancel");
        cancel.setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        torchBtn = pill("Torch off");
        torchBtn.setOnClickListener(v -> toggleTorch());
        actions.addView(cancel);
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(-2, -2);
        gap.leftMargin = dp(14);
        actions.addView(torchBtn, gap);
        FrameLayout.LayoutParams ap = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        ap.bottomMargin = dp(56);
        root.addView(actions, ap);
        return root;
    }

    private TextView pill(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        t.setGravity(Gravity.CENTER);
        t.setMinWidth(dp(120));
        t.setPadding(dp(20), dp(12), dp(20), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(999));
        bg.setColor(0x40FFFFFF);
        bg.setStroke(dp(1), 0x66FFFFFF);
        t.setBackground(bg);
        t.setClickable(true);
        return t;
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());
                ImageAnalysis analysis = new ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build();
                analysis.setAnalyzer(executor, this::analyze);
                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
            } catch (Exception e) {
                hint.setText("Couldn't open the camera.");
            }
        }, androidx.core.content.ContextCompat.getMainExecutor(this));
    }

    @OptIn(markerClass = ExperimentalGetImage.class)
    private void analyze(@NonNull ImageProxy proxy) {
        if (done || busy || proxy.getImage() == null) {
            proxy.close();
            return;
        }
        busy = true;
        InputImage image = InputImage.fromMediaImage(proxy.getImage(), proxy.getImageInfo().getRotationDegrees());
        recognizer.process(image)
            .addOnSuccessListener(text -> onText(text.getText()))
            .addOnCompleteListener(t -> {
                busy = false;
                proxy.close();
            });
    }

    private void onText(String text) {
        if (done) return;
        CardTextParser.Result r = CardTextParser.parse(text);
        if (r.number != null) {
            // The same number in two frames in a row: not an OCR fluke.
            sameNumberHits = r.number.equals(lastNumber) ? sameNumberHits + 1 : 1;
            lastNumber = r.number;
            if (sameNumberHits >= 2 && number == null) {
                number = r.number;
                numberAt = System.currentTimeMillis();
            }
        }
        if (r.expiry != null) expiry = r.expiry;
        if (r.name != null && name == null) name = r.name;

        if (number == null) return;
        long waited = System.currentTimeMillis() - numberAt;
        boolean complete = expiry != null && name != null;
        if (complete || (expiry != null && waited > 1200) || waited > EXTRA_LOOK_MS) {
            finishWith();
        } else {
            String l4 = number.substring(number.length() - 4);
            hint.setText(expiry == null
                ? "Got •••• " + l4 + ". Show the side with the expiry date…"
                : "Got •••• " + l4 + " · " + expiry + "…");
        }
    }

    private void finishWith() {
        if (done) return;
        done = true;
        Intent data = new Intent()
            .putExtra(EXTRA_NUMBER, number)
            .putExtra(EXTRA_EXPIRY, expiry)
            .putExtra(EXTRA_NAME, name);
        setResult(RESULT_OK, data);
        finish();
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torchOn = !torchOn;
        camera.getCameraControl().enableTorch(torchOn);
        torchBtn.setText(torchOn ? "Torch on" : "Torch off");
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** Dims everything but a card-shaped window in the middle. */
    private static final class FrameOverlay extends View {
        private final Paint dim = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint edge = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final RectF card = new RectF();

        FrameOverlay(android.content.Context ctx) {
            super(ctx);
            dim.setColor(0x99000000);
            edge.setStyle(Paint.Style.STROKE);
            edge.setColor(Color.WHITE);
            edge.setStrokeWidth(ctx.getResources().getDisplayMetrics().density * 2.5f);
        }

        @Override
        protected void onDraw(@NonNull Canvas canvas) {
            float w = getWidth();
            float h = getHeight();
            float cw = w * 0.86f;
            float ch = cw / 1.586f; // ID-1 card ratio
            float left = (w - cw) / 2f;
            float top = (h - ch) / 2f - h * 0.04f;
            float r = cw * 0.05f;
            card.set(left, top, left + cw, top + ch);
            path.reset();
            path.setFillType(Path.FillType.EVEN_ODD);
            path.addRect(0, 0, w, h, Path.Direction.CW);
            path.addRoundRect(card, r, r, Path.Direction.CW);
            canvas.drawPath(path, dim);
            canvas.drawRoundRect(card, r, r, edge);
        }
    }
}
