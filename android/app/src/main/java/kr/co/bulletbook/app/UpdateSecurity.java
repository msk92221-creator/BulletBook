package kr.co.bulletbook.app;

import java.net.URL;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.regex.Pattern;

final class UpdateSecurity {
    private static final Pattern DATE_PATTERN = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private static final Pattern MONTH_PATTERN = Pattern.compile("\\d{4}-\\d{2}");
    private static final String TRUSTED_RELEASE_HOST = "github.com";
    private static final String TRUSTED_RELEASE_PATH =
        "/msk92221-creator/BulletBook/releases/download/";

    private UpdateSecurity() {}

    static String canonicalWidgetDate(String value) {
        if (value == null || !DATE_PATTERN.matcher(value).matches()) return null;
        try {
            return LocalDate.parse(value).toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    static String canonicalWidgetMonth(String value) {
        if (value == null || !MONTH_PATTERN.matcher(value).matches()) return null;
        try {
            return YearMonth.parse(value).toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    static boolean isTrustedReleaseAsset(String address) {
        if (address == null || address.isEmpty()) return false;
        try {
            URL url = new URL(address);
            return "https".equalsIgnoreCase(url.getProtocol()) &&
                TRUSTED_RELEASE_HOST.equalsIgnoreCase(url.getHost()) &&
                url.getPath().startsWith(TRUSTED_RELEASE_PATH);
        } catch (Exception ignored) {
            return false;
        }
    }
}