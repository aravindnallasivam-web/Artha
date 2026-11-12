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
    /** Location fixes per SMS (PromptQueue.smsKey → {lat,lng,acc,at}), picked up by the app. */
    static final String KEY_SMS_LOCATIONS = "sms_locations";
    private static final long LOCATION_TTL_MS = 7L * 24 * 60 * 60 * 1000;
    private static final int LOCATION_MAX = 300;

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

    /** Save the location with each expense SMS: its own setting (on by default), needs location permission. */
    static boolean saveLocationEnabled(Context ctx) {
        return config(ctx).optBoolean("saveLocation", true) && hasPermission(ctx);
    }

    /** Remember where the phone was for this SMS, so the app can store it with the expense. */
    static synchronized void rememberForSms(Context ctx, String address, String body, Location loc) {
        if (loc == null || body == null || body.isEmpty()) return;
        android.content.SharedPreferences prefs = ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE);
        JSONObject map;
        try {
            map = new JSONObject(prefs.getString(KEY_SMS_LOCATIONS, "{}"));
        } catch (Exception e) {
            map = new JSONObject();
        }
        long cutoff = System.currentTimeMillis() - LOCATION_TTL_MS;
        JSONObject kept = new JSONObject();
        java.util.Iterator<String> keys = map.keys();
        List<String> order = new ArrayList<>();
        while (keys.hasNext()) {
            String k = keys.next();
            JSONObject v = map.optJSONObject(k);
            if (v != null && v.optLong("saved", 0) >= cutoff) order.add(k);
        }
        // Drop the oldest beyond the cap.
        int skip = Math.max(0, order.size() - (LOCATION_MAX - 1));
        for (int i = skip; i < order.size(); i++) {
            try { kept.put(order.get(i), map.optJSONObject(order.get(i))); } catch (Exception ignored) { }
        }
        try {
            kept.put(PromptQueue.smsKey(body, address), locationJson(loc).put("saved", System.currentTimeMillis()));
        } catch (Exception ignored) {
            return;
        }
        prefs.edit().putString(KEY_SMS_LOCATIONS, kept.toString()).apply();
    }

    // ---- Shops learned by place: "at this spot I paid Blue Tokai Coffee (Food › Café)" ----

    static final String KEY_PLACE_MEMORY = "place_memory";
    private static final int PLACE_MEMORY_MAX = 500;
    /** How close a new fix must be to a remembered spot to count as the same shop. */
    private static final int PLACE_MATCH_M = 40;

    static final class Remembered {
        final String name;
        final String categoryId;
        final int distanceM;

        Remembered(String name, String categoryId, int distanceM) {
            this.name = name;
            this.categoryId = categoryId;
            this.distanceM = distanceM;
        }
    }

    private static JSONArray placeMemory(Context ctx) {
        try {
            return new JSONArray(ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
                .getString(KEY_PLACE_MEMORY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Remember the shop (and category) the user chose at this spot. */
    static synchronized void rememberPlace(Context ctx, double lat, double lng, String name, String categoryId) {
        if (name == null || name.trim().isEmpty()) return;
        JSONArray old = placeMemory(ctx);
        JSONArray kept = new JSONArray();
        float[] r = new float[1];
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null) continue;
            Location.distanceBetween(lat, lng, o.optDouble("lat"), o.optDouble("lng"), r);
            // The same spot picked again replaces the old answer.
            if (r[0] <= PLACE_MATCH_M / 2f) continue;
            kept.put(o);
        }
        try {
            kept.put(new JSONObject()
                .put("lat", Math.round(lat * 1e5) / 1e5)
                .put("lng", Math.round(lng * 1e5) / 1e5)
                .put("name", name.trim())
                .put("categoryId", categoryId != null ? categoryId : "")
                .put("at", System.currentTimeMillis()));
        } catch (Exception ignored) {
            return;
        }
        while (kept.length() > PLACE_MEMORY_MAX) kept.remove(0);
        ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_PLACE_MEMORY, kept.toString()).apply();
    }

    /** The shop remembered closest to `loc` (within ~40 m, more when the fix is rough), or null. */
    static Remembered recall(Context ctx, Location loc) {
        if (loc == null) return null;
        int limit = PLACE_MATCH_M;
        if (loc.hasAccuracy()) limit = Math.max(PLACE_MATCH_M, Math.min(Math.round(loc.getAccuracy()), 80));
        JSONArray mem = placeMemory(ctx);
        Remembered best = null;
        for (int i = 0; i < mem.length(); i++) {
            JSONObject o = mem.optJSONObject(i);
            if (o == null) continue;
            int d = distance(loc, o.optDouble("lat"), o.optDouble("lng"));
            if (d <= limit && (best == null || d < best.distanceM)) {
                best = new Remembered(o.optString("name"), o.optString("categoryId", ""), d);
            }
        }
        return best;
    }

    static JSONObject locationJson(Location loc) throws org.json.JSONException {
        return new JSONObject()
            .put("lat", loc.getLatitude())
            .put("lng", loc.getLongitude())
            .put("accuracy", loc.hasAccuracy() ? Math.round(loc.getAccuracy()) : JSONObject.NULL)
            .put("at", loc.getTime());
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

    /** Up to `max` named shops around `loc`, nearest first; empty when offline or nothing is near. */
    static List<Place> findAround(Context ctx, Location loc, int max) {
        try {
            return lookup(ctx, loc, max);
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    /** Like findAround, but throws when the map service can't be reached (offline, error). */
    static List<Place> lookup(Context ctx, Location loc, int max) throws Exception {
        List<Place> out = new ArrayList<>();
        if (loc == null) return out;
        String googleKey = config(ctx).optString("googleKey", "").trim();
        out = googleKey.isEmpty() ? overpass(loc) : google(loc, googleKey);
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
    static Location currentLocation(Context ctx, int timeoutMs) {
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
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new java.io.IOException("Map service HTTP " + code);
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
