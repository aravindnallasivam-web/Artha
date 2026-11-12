package com.artha.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pulls the card number, expiry and name out of the text the camera reads on
 * a payment card. The number must pass the Luhn checksum, so stray digits
 * (customer-care numbers, account ids) are ignored. The CVV is never read:
 * the user types it.
 */
final class CardTextParser {

    static final class Result {
        String number;
        String expiry;
        String name;
    }

    /** Digit groups with the separators cards print: "4111 1111 1111 1111", "3782 822463 10005". */
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(\\d[\\d ]{11,23}\\d)(?!\\d)");
    private static final Pattern EXPIRY = Pattern.compile("(?<!\\d)(0[1-9]|1[0-2])\\s?[/\\-]\\s?(\\d{4}|\\d{2})(?!\\d)");
    private static final Pattern EXPIRY_LABEL = Pattern.compile(
        "(?i)(valid\\s*thru|valid\\s*through|valid\\s*till|good\\s*thru|exp(?:iry|ires)?|expiry\\s*date|thru|upto)");
    private static final Pattern NAME_LINE = Pattern.compile("^[A-Z][A-Z.'\\-]*(?: [A-Z][A-Z.'\\-]*){1,4}$");
    /** Words printed on cards that are never the holder's name. */
    private static final Pattern NOT_NAME = Pattern.compile(
        "(?i)\\b(valid|thru|through|from|member|since|expiry|exp|debit|credit|card|bank|visa|master|mastercard|rupay|"
            + "maestro|amex|american|express|diners|discover|platinum|gold|titanium|signature|classic|world|select|"
            + "infinite|business|corporate|international|electronic|use|only|contactless|authorized|signature|not|"
            + "valid|customer|care|call|www|com|india|limited|ltd|plc|millennia|regalia|moneyback|coral|rubyx|sapphiro|"
            + "simplyclick|prime|pay|neo|ace|flipkart|amazon|cashback|rewards?|premier|privilege|priority|platina|"
            + "issued|property|of|if|found|return|global|value|prepaid|forex|multi|currency|virtual|first)\\b");

    private CardTextParser() {}

    static Result parse(String text) {
        Result r = new Result();
        if (text == null) return r;
        r.number = number(text);
        r.expiry = expiry(text);
        r.name = name(text);
        return r;
    }

    static String number(String text) {
        // OCR reads "O" for 0 and "l"/"I" for 1 inside digit runs now and then.
        String t = text.replaceAll("(?<=\\d)[Oo](?=[\\d ])|(?<=[\\d ])[Oo](?=\\d)", "0")
            .replaceAll("(?<=\\d)[lI|](?=[\\d ])|(?<=[\\d ])[lI|](?=\\d)", "1");
        Matcher m = NUMBER.matcher(t);
        String best = null;
        while (m.find()) {
            String digits = m.group(1).replaceAll("\\D", "");
            if (digits.length() < 13 || digits.length() > 19) continue;
            if (!luhn(digits)) continue;
            if (best == null || digits.length() > best.length()) best = digits;
        }
        return best;
    }

    /** "MM/YY": the date after "VALID THRU" first, else the latest date on the card. */
    static String expiry(String text) {
        Matcher label = EXPIRY_LABEL.matcher(text);
        while (label.find()) {
            Matcher m = EXPIRY.matcher(text.substring(label.end(), Math.min(text.length(), label.end() + 24)));
            if (m.find()) return mmYY(m.group(1), m.group(2));
        }
        Matcher m = EXPIRY.matcher(text);
        String best = null;
        int bestKey = -1;
        while (m.find()) {
            String v = mmYY(m.group(1), m.group(2));
            // "VALID FROM 01/22 VALID THRU 01/27": the later date is the expiry.
            int key = Integer.parseInt(v.substring(3)) * 100 + Integer.parseInt(v.substring(0, 2));
            if (key > bestKey) {
                bestKey = key;
                best = v;
            }
        }
        return best;
    }

    private static String mmYY(String mm, String yy) {
        return mm + "/" + (yy.length() == 4 ? yy.substring(2) : yy);
    }

    /** An all-capitals line of 2–5 words that isn't bank / network / label text. */
    static String name(String text) {
        List<String> lines = new ArrayList<>();
        for (String line : text.split("\\r?\\n")) {
            String l = line.trim().replaceAll("\\s{2,}", " ");
            if (l.length() < 4 || l.length() > 30) continue;
            if (!NAME_LINE.matcher(l).matches()) continue;
            if (NOT_NAME.matcher(l).find()) continue;
            lines.add(l);
        }
        // The holder's name is printed last, under the number / expiry.
        return lines.isEmpty() ? null : lines.get(lines.size() - 1).toUpperCase(Locale.ROOT);
    }

    static boolean luhn(String digits) {
        int sum = 0;
        for (int i = 0; i < digits.length(); i++) {
            int d = digits.charAt(digits.length() - 1 - i) - '0';
            if (i % 2 == 1) {
                d *= 2;
                if (d > 9) d -= 9;
            }
            sum += d;
        }
        return sum % 10 == 0;
    }
}
