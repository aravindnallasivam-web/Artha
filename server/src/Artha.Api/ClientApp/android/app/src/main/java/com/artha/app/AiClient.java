package com.artha.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Asks the user's AI provider which category and account a bank SMS belongs
 * to, for the full-screen expense prompt (which runs without the WebView).
 * Mirrors core/ai/ai-provider.service.ts: same system prompt, same JSON
 * schema, Claude via the Messages API (structured output, low effort) or any
 * OpenAI-compatible /chat/completions server. The provider config is synced
 * here by the app (SmsReaderPlugin.setNotificationMappings) and never leaves
 * the device except to that provider.
 *
 * All calls block: run them off the main thread.
 */
final class AiClient {

    static final String KEY_AI_CONFIG = "ai_config";

    private static final String NONE = "none";
    private static final String ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
    private static final String ANTHROPIC_VERSION = "2026-10-21";
    private static final String DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

    private static final String SYSTEM_PROMPT =
        "You classify bank and UPI transaction SMS messages for a personal expense tracker used in India. "
            + "Pick the one category and the one account, from the lists given, that this transaction belongs to, and return their ids. "
            + "Match the account by bank name, sender code, the last digits of the card or account number, or the UPI handle in the message. "
            + "Match the category by the merchant or payee and what they sell. "
            + "If no listed category or account fits with reasonable confidence, return \"" + NONE + "\" for it rather than guessing. "
            + "Also return the merchant or payee name as a short, clean display name (for example \"Swiggy\", not \"SWIGGY*BANGALORE\").";

    /** What the model picked; null fields mean no confident match. Names, not ids. */
    static final class Suggestion {
        final String category;
        final String account;
        final String merchant;

        Suggestion(String category, String account, String merchant) {
            this.category = category;
            this.account = account;
            this.merchant = merchant;
        }
    }

    private static final class Config {
        String kind;
        String apiKey;
        String model;
        String baseUrl;
    }

    private AiClient() {}

    /** True when the app has a usable AI provider set up. */
    static boolean isConfigured(Context ctx) {
        return load(ctx) != null;
    }

    private static Config load(Context ctx) {
        String raw = ctx.getSharedPreferences(SmsBackgroundReceiver.PREFS, Context.MODE_PRIVATE)
            .getString(KEY_AI_CONFIG, null);
        if (raw == null || raw.isEmpty()) {
            return null;
        }
        try {
            JSONObject o = new JSONObject(raw);
            Config c = new Config();
            c.kind = o.optString("kind", "off");
            c.apiKey = o.optString("apiKey", "").trim();
            c.model = o.optString("model", "").trim();
            c.baseUrl = o.optString("baseUrl", "").trim().replaceAll("/+$", "");
            if ("anthropic".equals(c.kind)) {
                if (c.apiKey.isEmpty()) return null;
                if (c.model.isEmpty()) c.model = DEFAULT_CLAUDE_MODEL;
                return c;
            }
            if ("openai-compatible".equals(c.kind)) {
                return c.baseUrl.isEmpty() || c.model.isEmpty() ? null : c;
            }
            return null;
        } catch (JSONException e) {
            return null;
        }
    }

    /**
     * Classify one SMS. Returns null when AI is off, the call fails or times out,
     * or the model declines. Never throws.
     */
    static Suggestion classify(Context ctx, String sender, String body, double amount, String date,
                               List<String> categories, List<String> accounts, int timeoutMs) {
        Config config = load(ctx);
        if (config == null || body == null || body.isEmpty()
            || (categories.isEmpty() && accounts.isEmpty())) {
            return null;
        }
        try {
            JSONObject schema = schema(categories.size(), accounts.size());
            String prompt = userPrompt(sender, body, amount, date, categories, accounts);
            JSONObject raw = "anthropic".equals(config.kind)
                ? callClaude(config, prompt, schema, timeoutMs)
                : callCompatible(config, prompt, schema, timeoutMs);
            if (raw == null) {
                return null;
            }
            return new Suggestion(
                pick(raw.optString("categoryId", ""), "c", categories),
                pick(raw.optString("accountId", ""), "a", accounts),
                emptyToNull(raw.optString("merchant", "").trim()));
        } catch (Exception e) {
            return null;
        }
    }

    // Ids are the list position with a prefix ("c0", "a2"), mapped back to names.
    private static String pick(String id, String prefix, List<String> names) {
        if (id == null || !id.startsWith(prefix)) return null;
        try {
            int i = Integer.parseInt(id.substring(prefix.length()));
            return i >= 0 && i < names.size() ? names.get(i) : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static JSONObject schema(int categoryCount, int accountCount) throws JSONException {
        JSONArray catIds = new JSONArray();
        for (int i = 0; i < categoryCount; i++) catIds.put("c" + i);
        catIds.put(NONE);
        JSONArray accIds = new JSONArray();
        for (int i = 0; i < accountCount; i++) accIds.put("a" + i);
        accIds.put(NONE);
        JSONObject props = new JSONObject()
            .put("categoryId", new JSONObject().put("type", "string").put("enum", catIds))
            .put("accountId", new JSONObject().put("type", "string").put("enum", accIds))
            .put("merchant", new JSONObject().put("type", "string"));
        return new JSONObject()
            .put("type", "object")
            .put("properties", props)
            .put("required", new JSONArray().put("categoryId").put("accountId").put("merchant"))
            .put("additionalProperties", false);
    }

    private static String userPrompt(String sender, String body, double amount, String date,
                                     List<String> categories, List<String> accounts) {
        StringBuilder sb = new StringBuilder();
        sb.append("<sms sender=\"").append(sender).append("\" date=\"").append(date)
            .append("\" amount=\"").append(amount).append("\">\n")
            .append(body).append("\n</sms>\n\nCategories (id: name):\n");
        appendList(sb, "c", categories);
        sb.append("\nAccounts (id: name):\n");
        appendList(sb, "a", accounts);
        return sb.toString();
    }

    private static void appendList(StringBuilder sb, String prefix, List<String> names) {
        if (names.isEmpty()) {
            sb.append("(none)\n");
            return;
        }
        for (int i = 0; i < names.size(); i++) {
            sb.append("- ").append(prefix).append(i).append(": ").append(names.get(i)).append('\n');
        }
    }

    /** Messages API with structured output; returns the parsed JSON answer or null. */
    private static JSONObject callClaude(Config config, String prompt, JSONObject schema, int timeoutMs)
        throws Exception {
        JSONObject body = new JSONObject()
            .put("model", config.model)
            .put("max_tokens", 4000)
            .put("system", SYSTEM_PROMPT)
            .put("output_config", new JSONObject()
                .put("effort", "low")
                .put("format", new JSONObject().put("type", "json_schema").put("schema", schema)))
            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", prompt)));
        String beta = null;
        // Same rule as the app: the models with server-side fallback get it, so a
        // safety decline is retried on Anthropic's recommended model.
        if (supportsDefaultFallback(config.model)) {
            body.put("fallbacks", "default");
            beta = "server-side-fallback-2026-07-01";
        }
        HttpURLConnection conn = open(ANTHROPIC_URL, timeoutMs);
        conn.setRequestProperty("x-api-key", config.apiKey);
        conn.setRequestProperty("anthropic-version", ANTHROPIC_VERSION);
        if (beta != null) {
            conn.setRequestProperty("anthropic-beta", beta);
        }
        JSONObject res = send(conn, body);
        if (res == null) return null;
        String stop = res.optString("stop_reason", "");
        if ("refusal".equals(stop) || "max_tokens".equals(stop)) return null;
        JSONArray content = res.optJSONArray("content");
        if (content == null) return null;
        // Thinking blocks can come first; the answer is the text block.
        for (int i = 0; i < content.length(); i++) {
            JSONObject block = content.optJSONObject(i);
            if (block != null && "text".equals(block.optString("type"))) {
                return parseJson(block.optString("text", ""));
            }
        }
        return null;
    }

    private static boolean supportsDefaultFallback(String model) {
        return "claude-opus-5-5".equals(model) || "claude-opus-5".equals(model)
            || "claude-fable-5-1".equals(model) || "claude-sonnet-5-5".equals(model);
    }

    /** OpenAI-compatible /chat/completions in JSON mode; returns the parsed answer or null. */
    private static JSONObject callCompatible(Config config, String prompt, JSONObject schema, int timeoutMs)
        throws Exception {
        JSONObject body = new JSONObject()
            .put("model", config.model)
            .put("response_format", new JSONObject().put("type", "json_object"))
            .put("messages", new JSONArray()
                .put(new JSONObject().put("role", "system").put("content",
                    SYSTEM_PROMPT + " Reply with only a JSON object matching this JSON Schema: " + schema))
                .put(new JSONObject().put("role", "user").put("content", prompt)));
        HttpURLConnection conn = open(config.baseUrl + "/chat/completions", timeoutMs);
        if (!config.apiKey.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + config.apiKey);
        }
        JSONObject res = send(conn, body);
        if (res == null) return null;
        JSONArray choices = res.optJSONArray("choices");
        JSONObject first = choices != null ? choices.optJSONObject(0) : null;
        JSONObject message = first != null ? first.optJSONObject("message") : null;
        String text = message != null ? message.optString("content", "") : "";
        return text.isEmpty() ? null : parseJson(text);
    }

    private static HttpURLConnection open(String url, int timeoutMs) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(Math.min(timeoutMs, 5000));
        conn.setReadTimeout(timeoutMs);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        return conn;
    }

    /** POST `body`; the response JSON on 2xx, else null. */
    private static JSONObject send(HttpURLConnection conn, JSONObject body) throws Exception {
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bytes);
            }
            int status = conn.getResponseCode();
            if (status < 200 || status >= 300) {
                return null;
            }
            try (InputStream in = conn.getInputStream()) {
                return new JSONObject(readAll(in));
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) != -1) {
            buf.write(chunk, 0, n);
        }
        return buf.toString("UTF-8");
    }

    /** Parse a JSON answer, tolerating ```json fences from chatty models. */
    private static JSONObject parseJson(String text) {
        String t = text.trim().replaceAll("^```(?:json)?\\s*", "").replaceAll("```$", "").trim();
        try {
            return new JSONObject(t);
        } catch (JSONException e) {
            return null;
        }
    }

    private static String emptyToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }
}
