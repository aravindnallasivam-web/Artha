package com.artha.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.HandlerThread;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * "Nearby shops" for the full-screen expense prompt: one location fix (only
 * while the prompt is on screen, so the normal "while using the app"
 * permission is enough), then the named shops within ~150 m from
 * OpenStreetMap (Overpass, free, no key) or, when the user saved a key in
 * Settings, Google Places. Only the coordinates leave the device.
 *
 * Every method blocks: call from a worker thread.
 */
final class NearbyPlaces {

    static final String KEY_NEARBY = "nearby_config";

    private static final int RADIUS_M = 150;
    private static final String OVERPASS_URL = "https://overpass-api.de/api/interpreter";
    private static final String GOOGLE_URL = "https://places.googleapis.com/v1/places:searchNearby";
    private static final String AMENITIES =
        "restaurant|cafe|fast_food|food_court|bar|pub|ice_cream|fuel|pharmacy|cinema|marketplace|clinic|doctors|dentist|hospital";

    /** A shop near the user. `hint` holds words to match against category names. */
    static final class Place {
        final String name;
        final String kind;
        final String[] hint;
        final int distanceM;

        Place(String name, String kind, String[] hint, int distanceM) {
            this.name = name;
            this.kind = kind;
            this.hint = hint;
            this.distanceM = distanceM;
        }
    }

    private NearbyPlaces() {}

    /** On in Settings (and permission granted)? */
    static boolean isEnabled(Context ctx) {
        return config(ctx).optBoolean("enabled", false) && hasPermission(ctx);
    }

    static boolean hasPermission(Context ctx) {
        if (Build.VERSION.SDK_INT < 23) return true;
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static JSONObject config(Context ctx) {
        String raw = ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE).getString(KEY_NEARBY, "{}");
        try {
            return new JSONObject(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    /** Up to `max` named shops nearest first, or an empty list (no fix, offline, nothing near). */
    static List<Place> find(Context ctx, int max) {
        List<Place> out = new ArrayList<>();
        if (!isEnabled(ctx)) return out;
        Location loc = currentLocation(ctx, 6000);
        if (loc == null) return out;
        String googleKey = config(ctx).optString("googleKey", "").trim();
        try {
            out = googleKey.isEmpty() ? overpass(loc) : google(loc, googleKey);
        } catch (Exception e) {
            out = new ArrayList<>();
        }
        out.sort((a, b) -> Integer.compare(a.distanceM, b.distanceM));
        // One chip per name (chains often have several entries).
        List<Place> unique = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Place p : out) {
            if (seen.add(p.name.toLowerCase(Locale.ROOT))) unique.add(p);
            if (unique.size() >= max) break;
        }
        return unique;
    }

    // ---- Location ----

    @SuppressWarnings({"MissingPermission", "deprecation"})
    private static Location currentLocation(Context ctx, int timeoutMs) {
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null || !hasPermission(ctx)) return null;
        List<String> providers = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31 && lm.hasProvider(LocationManager.FUSED_PROVIDER)) providers.add(LocationManager.FUSED_PROVIDER);
        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) providers.add(LocationManager.GPS_PROVIDER);
        if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) providers.add(LocationManager.NETWORK_PROVIDER);
        if (providers.isEmpty()) return null;

        // A fix from the last minute or two is as good as a new one.
        Location best = null;
        for (String p : providers) {
            try {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            } catch (Exception ignored) { }
        }
        if (best != null && System.currentTimeMillis() - best.getTime() < 90_000 && best.getAccuracy() <= 100) {
            return best;
        }

        final Location[] fix = new Location[1];
        final CountDownLatch latch = new CountDownLatch(1);
        String provider = providers.get(0);
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                lm.getCurrentLocation(provider, null, Executors.newSingleThreadExecutor(), l -> {
                    fix[0] = l;
                    latch.countDown();
                });
            } else {
                HandlerThread thread = new HandlerThread("artha-location");
                thread.start();
                lm.requestSingleUpdate(provider, new LocationListener() {
                    @Override public void onLocationChanged(Location l) {
                        fix[0] = l;
                        latch.countDown();
                        thread.quitSafely();
                    }
                    @Override public void onStatusChanged(String p, int s, Bundle b) { }
                    @Override public void onProviderEnabled(String p) { }
                    @Override public void onProviderDisabled(String p) { }
                }, thread.getLooper());
            }
            latch.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
            // Fall back to the last known fix below.
        }
        if (fix[0] != null) return fix[0];
        // Anything from the last 10 minutes beats nothing.
        return best != null && System.currentTimeMillis() - best.getTime() < 600_000 ? best : null;
    }

    // ---- OpenStreetMap (Overpass) ----

    private static List<Place> overpass(Location loc) throws Exception {
        String around = "(around:" + RADIUS_M + "," + loc.getLatitude() + "," + loc.getLongitude() + ")";
        String q = "[out:json][timeout:8];("
            + "node" + around + "[\"name\"][\"shop\"];"
            + "way" + around + "[\"name\"][\"shop\"];"
            + "node" + around + "[\"name\"][\"amenity\"~\"^(" + AMENITIES + ")$\"];"
            + "way" + around + "[\"name\"][\"amenity\"~\"^(" + AMENITIES + ")$\"];"
            + ");out center 60;";
        byte[] body = ("data=" + URLEncoder.encode(q, "UTF-8")).getBytes(StandardCharsets.UTF_8);
        HttpURLConnection conn = (HttpURLConnection) new URL(OVERPASS_URL).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(9000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        conn.setRequestProperty("User-Agent", "Artha-expense-app");
        JSONObject res = send(conn, body);
        List<Place> out = new ArrayList<>();
        JSONArray els = res != null ? res.optJSONArray("elements") : null;
        if (els == null) return out;
        for (int i = 0; i < els.length(); i++) {
            JSONObject el = els.optJSONObject(i);
            if (el == null) continue;
            JSONObject tags = el.optJSONObject("tags");
            if (tags == null) continue;
            String name = tags.optString("name:en", tags.optString("name", "")).trim();
            if (name.isEmpty()) continue;
            double lat = el.has("lat") ? el.optDouble("lat") : el.optJSONObject("center") != null ? el.optJSONObject("center").optDouble("lat") : Double.NaN;
            double lon = el.has("lon") ? el.optDouble("lon") : el.optJSONObject("center") != null ? el.optJSONObject("center").optDouble("lon") : Double.NaN;
            if (Double.isNaN(lat) || Double.isNaN(lon)) continue;
            String kind = tags.has("shop") ? tags.optString("shop") : tags.optString("amenity");
            out.add(new Place(name, kind, hintFor(kind), distance(loc, lat, lon)));
        }
        return out;
    }

    // ---- Google Places (New), when the user saved a key ----

    private static List<Place> google(Location loc, String key) throws Exception {
        JSONObject center = new JSONObject().put("latitude", loc.getLatitude()).put("longitude", loc.getLongitude());
        JSONObject reqBody = new JSONObject()
            .put("maxResultCount", 12)
            .put("rankPreference", "DISTANCE")
            .put("locationRestriction", new JSONObject().put("circle",
                new JSONObject().put("center", center).put("radius", RADIUS_M)));
        HttpURLConnection conn = (HttpURLConnection) new URL(GOOGLE_URL).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(5000);
        conn.setReadTimeout(8000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("X-Goog-Api-Key", key);
        conn.setRequestProperty("X-Goog-FieldMask", "places.displayName,places.primaryType,places.location");
        JSONObject res = send(conn, reqBody.toString().getBytes(StandardCharsets.UTF_8));
        List<Place> out = new ArrayList<>();
        JSONArray places = res != null ? res.optJSONArray("places") : null;
        if (places == null) return out;
        for (int i = 0; i < places.length(); i++) {
            JSONObject p = places.optJSONObject(i);
            if (p == null) continue;
            JSONObject dn = p.optJSONObject("displayName");
            String name = dn != null ? dn.optString("text", "").trim() : "";
            JSONObject l = p.optJSONObject("location");
            if (name.isEmpty() || l == null) continue;
            String kind = p.optString("primaryType", "");
            out.add(new Place(name, kind, hintFor(kind), distance(loc, l.optDouble("latitude"), l.optDouble("longitude"))));
        }
        return out;
    }

    // ---- Helpers ----

    /** Words to look for in category names, from an OSM / Google place type. */
    static String[] hintFor(String kind) {
        String k = kind == null ? "" : kind.toLowerCase(Locale.ROOT);
        if (k.contains("cafe") || k.contains("coffee") || k.contains("tea")) return new String[] {"café", "cafe", "coffee", "food"};
        if (k.contains("bakery") || k.contains("confectionery") || k.contains("ice_cream") || k.contains("dessert")) return new String[] {"bakery", "snacks", "food"};
        if (k.contains("restaurant") || k.contains("fast_food") || k.contains("food_court") || k.contains("meal")) return new String[] {"dining", "restaurant", "eating out", "food"};
        if (k.contains("bar") || k.contains("pub") || k.contains("alcohol") || k.contains("liquor")) return new String[] {"drinks", "alcohol", "entertainment", "food"};
        if (k.contains("supermarket") || k.contains("grocery") || k.contains("convenience") || k.contains("greengrocer")
            || k.contains("butcher") || k.contains("dairy") || k.contains("marketplace") || k.contains("market")) return new String[] {"groceries", "grocery", "food"};
        if (k.contains("fuel") || k.contains("gas_station")) return new String[] {"fuel", "petrol", "transport"};
        if (k.contains("pharmacy") || k.contains("chemist") || k.contains("drugstore")) return new String[] {"medicine", "pharmacy", "health", "medical"};
        if (k.contains("clinic") || k.contains("doctor") || k.contains("dentist") || k.contains("hospital")) return new String[] {"doctor", "medical", "health"};
        if (k.contains("cinema") || k.contains("movie")) return new String[] {"movies", "entertainment"};
        if (k.contains("hairdresser") || k.contains("beauty") || k.contains("salon") || k.contains("spa")) return new String[] {"personal care", "salon", "grooming"};
        if (k.contains("electronics") || k.contains("mobile") || k.contains("computer")) return new String[] {"electronics", "shopping"};
        if (k.contains("clothes") || k.contains("shoe") || k.contains("fashion") || k.contains("jewel")
            || k.contains("department") || k.contains("mall") || k.contains("gift")) return new String[] {"clothes", "shopping"};
        if (k.contains("hardware") || k.contains("furniture") || k.contains("doityourself")) return new String[] {"home", "household", "shopping"};
        if (k.contains("book") || k.contains("stationery")) return new String[] {"books", "education", "shopping"};
        return new String[] {"shopping"};
    }

    private static int distance(Location from, double lat, double lon) {
        float[] r = new float[1];
        Location.distanceBetween(from.getLatitude(), from.getLongitude(), lat, lon, r);
        return Math.round(r[0]);
    }

    private static JSONObject send(HttpURLConnection conn, byte[] body) throws Exception {
        try {
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) return null;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
                return new JSONObject(buf.toString("UTF-8"));
            }
        } finally {
            conn.disconnect();
        }
    }
}
