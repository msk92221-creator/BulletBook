package kr.co.bulletbook.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends BridgeActivity {
    private static final String CLIENT_ID = "2c714971-eb05-4abb-8a15-d08319774c6c";
    private static final String AUTHORITY =
        "https://login.microsoftonline.com/consumers/oauth2/v2.0";
    private static final String GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
    private static final String GRAPH_SCOPE =
        "openid profile offline_access https://graph.microsoft.com/Files.ReadWrite.AppFolder";
    private static final String CLOUD_FILE_PATH =
        "/me/drive/special/approot:/BulletBook_sync.buj:/content";
    // Android용 업데이트는 GitHub Releases에서 받는다(예: BulletBook_v0.38.0.apk).
    // 공개 저장소라 익명으로 최신 릴리스를 조회할 수 있어 별도 토큰이 필요 없다.
    private static final String GITHUB_API_ROOT = "https://api.github.com";
    private static final String GITHUB_REPO = "msk92221-creator/BulletBook";
    private static final String GITHUB_RELEASES_LATEST =
        GITHUB_API_ROOT + "/repos/" + GITHUB_REPO + "/releases/latest";
    private static final Pattern VERSION_PATTERN =
        Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)");
    private static final int MAX_UPDATE_BYTES = 200 * 1024 * 1024;

    private static final String PREFS = "bulletbook_cloud";
    private static final String ACCESS_TOKEN = "access_token";
    private static final String REFRESH_TOKEN = "refresh_token";
    private static final String TOKEN_EXPIRES_AT = "token_expires_at";
    private static final String ACCOUNT_LABEL = "account_label";
    private static final String LEGACY_CLOUD_URI = "cloud_uri";
    private static final String PENDING_DEVICE_CODE = "pending_device_code";
    private static final String PENDING_LOGIN_EXPIRES_AT = "pending_login_expires_at";
    private static final String PENDING_NEXT_POLL_AT = "pending_next_poll_at";
    private static final String PENDING_POLL_INTERVAL = "pending_poll_interval";
    private static final String TOKEN_KEY_ALIAS = "bulletbook_cloud_token_key_v1";
    private static final String ENCRYPTED_TOKEN_PREFIX = "enc-v1:";
    private static final long BACK_EXIT_WINDOW_MS = 2000L;

    private final ExecutorService cloudExecutor = Executors.newSingleThreadExecutor();
    private String pendingDeviceCode;
    private long pendingLoginExpiresAt;
    private long pendingNextPollAt;
    private int pendingPollIntervalSeconds = 5;
    private WebView webView;
    private Handler loginPollHandler;
    private long lastBackPressedAt;
    // 위젯 날짜/월 클릭으로 온 Intent를 WebView 준비 전까지 보관한다.
    private String pendingWidgetDate;
    private String pendingWidgetMonth;
    private boolean widgetNavigationDispatched;
    private final Runnable automaticLoginPoll = () -> cloudExecutor.execute(() -> {
        try {
            JSONObject result = pollPendingLoginOnce();
            String status = result.optString("status", "");
            if ("authorized".equals(status) || "failed".equals(status)) {
                notifyCloudLoginStateChanged();
                return;
            }
            scheduleAutomaticLoginPoll(pendingPollIntervalSeconds * 1000L);
        } catch (Exception error) {
            if (pendingDeviceCode != null &&
                System.currentTimeMillis() < pendingLoginExpiresAt) {
                scheduleAutomaticLoginPoll(3000L);
            }
        }
    });

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loginPollHandler = new Handler(Looper.getMainLooper());
        webView = getBridge().getWebView();

        // Android 15/16의 edge-to-edge 영역에서 앱 전체를 시스템 UI 안쪽으로 배치한다.
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            final int baseLeft = contentView.getPaddingLeft();
            final int baseTop = contentView.getPaddingTop();
            final int baseRight = contentView.getPaddingRight();
            final int baseBottom = contentView.getPaddingBottom();
            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                int safeTypes =
                    WindowInsetsCompat.Type.systemBars() |
                    WindowInsetsCompat.Type.displayCutout();
                Insets safeInsets = windowInsets.getInsets(safeTypes);
                view.setPadding(
                    baseLeft + safeInsets.left,
                    baseTop + safeInsets.top,
                    baseRight + safeInsets.right,
                    baseBottom + safeInsets.bottom
                );
                return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(safeTypes, Insets.NONE)
                    .build();
            });
            ViewCompat.requestApplyInsets(contentView);
        }

        webView.addJavascriptInterface(new CloudAccountBridge(), "BulletBookNative");
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleAppBackPressed();
            }
        });
        restorePendingLogin();
        scheduleAutomaticLoginPoll(0L);
        captureWidgetIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureWidgetIntent(intent);
        // 앱이 이미 떠 있으면 JS가 준비되어 있으니 바로 전달한다.
        dispatchWidgetNavigation();
    }

    /** 위젯이 보낸 bulletbook://calendar/YYYY-MM-DD 또는 bulletbook://month/YYYY-MM을 보관한다. */
    private void captureWidgetIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri data = intent.getData();
        if (data == null || !"bulletbook".equals(data.getScheme())) return;
        String host = data.getHost();
        String path = data.getLastPathSegment();
        if (host == null || path == null) return;
        if ("calendar".equals(host)) {
            String date = UpdateSecurity.canonicalWidgetDate(path);
            if (date == null) return;
            pendingWidgetDate = date;
            pendingWidgetMonth = null;
            widgetNavigationDispatched = false;
        } else if ("month".equals(host)) {
            String month = UpdateSecurity.canonicalWidgetMonth(path);
            if (month == null) return;
            pendingWidgetMonth = month;
            pendingWidgetDate = null;
            widgetNavigationDispatched = false;
        }
    }


    /**
     * 보관된 위젯 딥링크를 WebView의 JS 콜백으로 넘긴다.
     * 실제 트리거는 CloudAccountBridge.readyForWidgetNavigation()에서 이 메서드를 부른다.
     */
    private void dispatchWidgetNavigation() {
        if (widgetNavigationDispatched) return;
        String date = pendingWidgetDate;
        String month = pendingWidgetMonth;
        if (date == null && month == null) return;
        if (webView == null) return;
        widgetNavigationDispatched = true;
        try {
            if (date != null) {
                webView.evaluateJavascript(
                    "(window.__bulletBookOpenWidgetDate||function(){})(" +
                        JSONObject.quote(date) + ");",
                    null
                );
                pendingWidgetDate = null;
            } else if (month != null) {
                webView.evaluateJavascript(
                    "(window.__bulletBookOpenWidgetMonth||function(){})(" +
                        JSONObject.quote(month) + ");",
                    null
                );
                pendingWidgetMonth = null;
            }
        } catch (Exception ignored) {
            widgetNavigationDispatched = false;
        }
    }

    private void handleAppBackPressed() {
        if (webView == null) {
            handleExitBackPressed();
            return;
        }
        try {
            webView.evaluateJavascript(
                "(function(){try{return !!window.__bulletBookHandleBack?.()}catch(e){return false}})()",
                result -> {
                    if ("true".equalsIgnoreCase(String.valueOf(result).replace("\"", ""))) {
                        lastBackPressedAt = 0L;
                        return;
                    }
                    handleExitBackPressed();
                }
            );
        } catch (Exception ignored) {
            handleExitBackPressed();
        }
    }

    private void handleExitBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt <= BACK_EXIT_WINDOW_MS) {
            finish();
            return;
        }
        lastBackPressedAt = now;
        Toast.makeText(this, "한 번 더 뒤로가기를 누르면 종료됩니다", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onResume() {
        super.onResume();
        cloudExecutor.execute(() -> scheduleAutomaticLoginPoll(0L));
        if (webView == null) return;
        webView.post(() ->
            webView.evaluateJavascript(
                "window.__bulletBookCloudResume?.()",
                null
            )
        );
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (webView == null) return;
        webView.post(() ->
            webView.evaluateJavascript(
                "window.__bulletBookDisplayModeChanged?.()",
                null
            )
        );
    }

    @Override
    public void onDestroy() {
        if (loginPollHandler != null) {
            loginPollHandler.removeCallbacks(automaticLoginPoll);
        }
        cloudExecutor.shutdown();
        super.onDestroy();
    }

    private SharedPreferences preferences() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void clearLegacyFileConnection() {
        String value = preferences().getString(LEGACY_CLOUD_URI, "");
        if (value.isEmpty()) return;
        try {
            getContentResolver().releasePersistableUriPermission(
                Uri.parse(value),
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (Exception ignored) {
            // 이전 파일 권한이 이미 만료된 경우 저장값만 지운다.
        }
        preferences().edit().remove(LEGACY_CLOUD_URI).apply();
    }

    private String readLegacyCloudBook() {
        String value = preferences().getString(LEGACY_CLOUD_URI, "");
        if (value.isEmpty()) return "";
        try {
            InputStream input = getContentResolver().openInputStream(Uri.parse(value));
            return input == null ? "" : readStream(input);
        } catch (Exception ignored) {
            return "";
        }
    }

    private boolean isNonPristineLegacyBook(String content) {
        if (content == null || content.trim().isEmpty()) return false;
        try {
            JSONObject value = new JSONObject(content);
            return "bulletbook".equals(value.optString("format")) &&
                !value.optBoolean("syncPristine", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean isPristineCloudBook(String content) {
        if (content == null || content.trim().isEmpty()) return true;
        try {
            JSONObject value = new JSONObject(content);
            return "bulletbook".equals(value.optString("format")) &&
                value.optBoolean("syncPristine", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void sendResult(String requestId, boolean ok, String payload) {
        if (requestId == null || webView == null) return;
        String script = "window.__bulletBookNativeResult(" +
            JSONObject.quote(requestId) + "," + ok + "," +
            JSONObject.quote(payload == null ? "" : payload) + ")";
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private void sendJson(String requestId, JSONObject value) {
        sendResult(requestId, true, value.toString());
    }

    private void sendError(String requestId, String code, String message) {
        try {
            JSONObject value = new JSONObject();
            value.put("code", code == null ? "SYNC_ERROR" : code);
            value.put("message", message == null ? "OneDrive 작업에 실패했습니다." : message);
            sendResult(requestId, false, value.toString());
        } catch (Exception ignored) {
            sendResult(requestId, false, message);
        }
    }

    private static final class CloudException extends Exception {
        final String code;

        CloudException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static final class HttpResult {
        final int status;
        final String body;
        final String location;

        HttpResult(int status, String body, String location) {
            this.status = status;
            this.body = body;
            this.location = location;
        }
    }

    private HttpResult request(
        String address,
        String method,
        String body,
        String contentType,
        String accessToken,
        boolean followRedirects
    ) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(followRedirects);
        connection.setRequestProperty("Accept", "application/json");
        if (accessToken != null && !accessToken.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
        }
        if (body != null) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty(
                "Content-Type",
                contentType == null ? "application/json; charset=utf-8" : contentType
            );
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
                output.flush();
            }
        }

        int status = connection.getResponseCode();
        String location = connection.getHeaderField("Location");
        InputStream stream = status >= 400
            ? connection.getErrorStream()
            : connection.getInputStream();
        String responseBody = stream == null ? "" : readStream(stream);
        connection.disconnect();
        return new HttpResult(status, responseBody, location);
    }

    private String readStream(InputStream input) throws Exception {
        try (InputStream source = input;
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = source.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private String formEncode(Map<String, String> values) throws Exception {
        StringBuilder body = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (body.length() > 0) body.append('&');
            body.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8.name()));
            body.append('=');
            body.append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8.name()));
        }
        return body.toString();
    }

    private HttpResult postForm(String address, Map<String, String> values) throws Exception {
        return request(
            address,
            "POST",
            formEncode(values),
            "application/x-www-form-urlencoded",
            null,
            true
        );
    }

    private String decodeAccountLabel(String idToken) {
        if (idToken == null || idToken.isEmpty()) return "";
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return "";
            byte[] decoded = Base64.decode(
                parts[1],
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
            );
            JSONObject payload = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
            String label = payload.optString("preferred_username", "");
            if (label.isEmpty()) label = payload.optString("email", "");
            if (label.isEmpty()) label = payload.optString("name", "");
            return label;
        } catch (Exception ignored) {
            return "";
        }
    }

    private SecretKey tokenSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(TOKEN_KEY_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );
        generator.init(
            new KeyGenParameterSpec.Builder(
                TOKEN_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        );
        return generator.generateKey();
    }

    private String encryptToken(String plainText) throws Exception {
        if (plainText == null || plainText.isEmpty()) return "";
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, tokenSecretKey());
        byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
        return ENCRYPTED_TOKEN_PREFIX +
            Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decryptToken(String stored) throws Exception {
        if (stored == null || stored.isEmpty()) return "";
        if (!stored.startsWith(ENCRYPTED_TOKEN_PREFIX)) return stored;
        String[] parts = stored.substring(ENCRYPTED_TOKEN_PREFIX.length()).split(":", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid encrypted token");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, tokenSecretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private String readStoredToken(String key) throws Exception {
        String stored = preferences().getString(key, "");
        if (stored == null || stored.isEmpty()) return "";
        try {
            String plainText = decryptToken(stored);
            if (!stored.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
                preferences().edit().putString(key, encryptToken(plainText)).apply();
            }
            return plainText;
        } catch (Exception error) {
            clearToken();
            throw new CloudException(
                "AUTH_REQUIRED",
                "보호된 Microsoft 로그인 정보를 읽지 못했습니다. 다시 로그인해 주세요."
            );
        }
    }
    private void saveToken(JSONObject payload) throws Exception {
        String existingRefreshToken = readStoredToken(REFRESH_TOKEN);
        String refreshToken = payload.optString("refresh_token", existingRefreshToken);
        if (refreshToken.isEmpty()) {
            throw new CloudException(
                "AUTH_REQUIRED",
                "자동 동기화용 로그인 권한을 받지 못했습니다. 다시 로그인해 주세요."
            );
        }
        String accountLabel = decodeAccountLabel(payload.optString("id_token", ""));
        if (accountLabel.isEmpty()) {
            accountLabel = preferences().getString(ACCOUNT_LABEL, "");
        }
        long expiresAt = System.currentTimeMillis() +
            Math.max(60, payload.optLong("expires_in", 3600)) * 1000L;
        preferences().edit()
            .putString(ACCESS_TOKEN, encryptToken(payload.optString("access_token", "")))
            .putString(REFRESH_TOKEN, encryptToken(refreshToken))
            .putLong(TOKEN_EXPIRES_AT, expiresAt)
            .putString(ACCOUNT_LABEL, accountLabel)
            .apply();
    }

    private void clearToken() {
        preferences().edit()
            .remove(ACCESS_TOKEN)
            .remove(REFRESH_TOKEN)
            .remove(TOKEN_EXPIRES_AT)
            .remove(ACCOUNT_LABEL)
            .apply();
    }

    private String accessToken(boolean forceRefresh) throws Exception {
        String refreshToken = readStoredToken(REFRESH_TOKEN);
        if (refreshToken.isEmpty()) {
            throw new CloudException("AUTH_REQUIRED", "Microsoft 계정 로그인이 필요합니다.");
        }
        String accessToken = readStoredToken(ACCESS_TOKEN);
        long expiresAt = preferences().getLong(TOKEN_EXPIRES_AT, 0);
        if (!forceRefresh && !accessToken.isEmpty() &&
            expiresAt > System.currentTimeMillis() + 60000) {
            return accessToken;
        }

        Map<String, String> form = new LinkedHashMap<>();
        form.put("client_id", CLIENT_ID);
        form.put("grant_type", "refresh_token");
        form.put("refresh_token", refreshToken);
        form.put("scope", GRAPH_SCOPE);
        HttpResult result = postForm(AUTHORITY + "/token", form);
        JSONObject payload = result.body.isEmpty()
            ? new JSONObject()
            : new JSONObject(result.body);
        if (result.status < 200 || result.status >= 300 ||
            payload.optString("access_token", "").isEmpty()) {
            if ("invalid_grant".equals(payload.optString("error"))) clearToken();
            throw new CloudException(
                "AUTH_REQUIRED",
                payload.optString(
                    "error_description",
                    "Microsoft 로그인 기간이 만료되었습니다. 다시 로그인해 주세요."
                )
            );
        }
        saveToken(payload);
        return readStoredToken(ACCESS_TOKEN);
    }

    private HttpResult graphRequest(
        String path,
        String method,
        String body,
        String contentType,
        boolean followRedirects,
        boolean retry
    ) throws Exception {
        HttpResult result = request(
            GRAPH_ROOT + path,
            method,
            body,
            contentType,
            accessToken(false),
            followRedirects
        );
        if (result.status == 401 && retry) {
            String refreshed = accessToken(true);
            result = request(
                GRAPH_ROOT + path,
                method,
                body,
                contentType,
                refreshed,
                followRedirects
            );
        }
        if (result.status == 401) {
            clearToken();
            throw new CloudException(
                "AUTH_REQUIRED",
                "Microsoft 로그인 기간이 만료되었습니다. 다시 로그인해 주세요."
            );
        }
        return result;
    }

    private String graphMessage(HttpResult result, String fallback) {
        try {
            JSONObject payload = new JSONObject(result.body);
            JSONObject error = payload.optJSONObject("error");
            if (error != null) return error.optString("message", fallback);
        } catch (Exception ignored) {
            // Graph 오류 JSON이 아니면 안내 문구를 사용한다.
        }
        return fallback;
    }

    private void ensureAppFolder() throws Exception {
        HttpResult result = graphRequest(
            "/me/drive/special/approot",
            "GET",
            null,
            null,
            true,
            true
        );
        if (result.status < 200 || result.status >= 300) {
            throw new CloudException(
                "GRAPH_ERROR",
                graphMessage(
                    result,
                    "OneDrive 앱 폴더에 접근하지 못했습니다. Files.ReadWrite.AppFolder 권한을 확인해 주세요."
                )
            );
        }
    }

    private String readCloudBook() throws Exception {
        ensureAppFolder();
        String legacyBook = readLegacyCloudBook();
        HttpResult result = graphRequest(
            CLOUD_FILE_PATH,
            "GET",
            null,
            null,
            false,
            true
        );
        if (result.status == 404) {
            if (isNonPristineLegacyBook(legacyBook)) {
                writeCloudBook(legacyBook);
                clearLegacyFileConnection();
                return legacyBook;
            }
            return "";
        }
        if (result.status >= 300 && result.status < 400 &&
            result.location != null && !result.location.isEmpty()) {
            HttpResult download = request(
                result.location,
                "GET",
                null,
                null,
                null,
                true
            );
            if (download.status >= 200 && download.status < 300) {
                if (isPristineCloudBook(download.body) &&
                    isNonPristineLegacyBook(legacyBook)) {
                    writeCloudBook(legacyBook);
                    clearLegacyFileConnection();
                    return legacyBook;
                }
                return download.body;
            }
            throw new CloudException(
                "GRAPH_ERROR",
                "OneDrive의 불렛북을 내려받지 못했습니다."
            );
        }
        if (result.status < 200 || result.status >= 300) {
            throw new CloudException(
                "GRAPH_ERROR",
                graphMessage(result, "OneDrive의 불렛북을 읽지 못했습니다.")
            );
        }
        if (isPristineCloudBook(result.body) && isNonPristineLegacyBook(legacyBook)) {
            writeCloudBook(legacyBook);
            clearLegacyFileConnection();
            return legacyBook;
        }
        return result.body;
    }

    private void writeCloudBook(String content) throws Exception {
        ensureAppFolder();
        HttpResult result = graphRequest(
            CLOUD_FILE_PATH,
            "PUT",
            content,
            "application/json; charset=utf-8",
            true,
            true
        );
        if (result.status < 200 || result.status >= 300) {
            throw new CloudException(
                "GRAPH_ERROR",
                graphMessage(result, "OneDrive에 불렛북을 저장하지 못했습니다.")
            );
        }
        clearLegacyFileConnection();
    }

    private void savePendingLoginState() {
        if (pendingDeviceCode == null) return;
        preferences().edit()
            .putString(PENDING_DEVICE_CODE, pendingDeviceCode)
            .putLong(PENDING_LOGIN_EXPIRES_AT, pendingLoginExpiresAt)
            .putLong(PENDING_NEXT_POLL_AT, pendingNextPollAt)
            .putInt(PENDING_POLL_INTERVAL, pendingPollIntervalSeconds)
            .apply();
    }

    private void restorePendingLogin() {
        String savedCode = preferences().getString(PENDING_DEVICE_CODE, "");
        long savedExpiry = preferences().getLong(PENDING_LOGIN_EXPIRES_AT, 0L);
        if (savedCode.isEmpty() || savedExpiry <= System.currentTimeMillis()) {
            preferences().edit()
                .remove(PENDING_DEVICE_CODE)
                .remove(PENDING_LOGIN_EXPIRES_AT)
                .remove(PENDING_NEXT_POLL_AT)
                .remove(PENDING_POLL_INTERVAL)
                .apply();
            return;
        }
        pendingDeviceCode = savedCode;
        pendingLoginExpiresAt = savedExpiry;
        pendingNextPollAt = preferences().getLong(PENDING_NEXT_POLL_AT, 0L);
        pendingPollIntervalSeconds = Math.max(
            2,
            preferences().getInt(PENDING_POLL_INTERVAL, 5)
        );
    }

    private void clearPendingLogin() {
        if (loginPollHandler != null) {
            loginPollHandler.removeCallbacks(automaticLoginPoll);
        }
        pendingDeviceCode = null;
        pendingLoginExpiresAt = 0;
        pendingNextPollAt = 0;
        pendingPollIntervalSeconds = 5;
        preferences().edit()
            .remove(PENDING_DEVICE_CODE)
            .remove(PENDING_LOGIN_EXPIRES_AT)
            .remove(PENDING_NEXT_POLL_AT)
            .remove(PENDING_POLL_INTERVAL)
            .apply();
    }

    private void scheduleAutomaticLoginPoll(long delayMillis) {
        if (loginPollHandler == null || pendingDeviceCode == null) return;
        loginPollHandler.removeCallbacks(automaticLoginPoll);
        loginPollHandler.postDelayed(
            automaticLoginPoll,
            Math.max(500L, delayMillis)
        );
    }

    private void notifyCloudLoginStateChanged() {
        if (webView == null) return;
        runOnUiThread(() ->
            webView.evaluateJavascript(
                "window.__bulletBookCloudLoginStateChanged?.()",
                null
            )
        );
    }

    private JSONObject authorizedLoginResult() throws Exception {
        JSONObject authorized = new JSONObject();
        authorized.put("status", "authorized");
        authorized.put(
            "accountLabel",
            preferences().getString(ACCOUNT_LABEL, "")
        );
        return authorized;
    }

    private JSONObject pollPendingLoginOnce() throws Exception {
        if (pendingDeviceCode == null) {
            if (!readStoredToken(REFRESH_TOKEN).isEmpty()) {
                return authorizedLoginResult();
            }
            throw new CloudException(
                "LOGIN_NOT_STARTED",
                "진행 중인 로그인이 없습니다."
            );
        }
        if (System.currentTimeMillis() >= pendingLoginExpiresAt) {
            clearPendingLogin();
            JSONObject expired = new JSONObject();
            expired.put("status", "failed");
            expired.put("code", "LOGIN_EXPIRED");
            expired.put("message", "로그인 시간이 만료되었습니다. 다시 시도해 주세요.");
            return expired;
        }
        if (System.currentTimeMillis() < pendingNextPollAt) {
            return new JSONObject().put("status", "pending");
        }
        pendingNextPollAt =
            System.currentTimeMillis() + pendingPollIntervalSeconds * 1000L;
        savePendingLoginState();

        Map<String, String> form = new LinkedHashMap<>();
        form.put(
            "grant_type",
            "urn:ietf:params:oauth:grant-type:device_code"
        );
        form.put("client_id", CLIENT_ID);
        form.put("device_code", pendingDeviceCode);
        HttpResult result = postForm(AUTHORITY + "/token", form);
        JSONObject payload = result.body.isEmpty()
            ? new JSONObject()
            : new JSONObject(result.body);

        if (result.status >= 200 && result.status < 300 &&
            !payload.optString("access_token", "").isEmpty()) {
            saveToken(payload);
            clearPendingLogin();
            return authorizedLoginResult();
        }

        String errorCode = payload.optString("error", "LOGIN_FAILED");
        if ("authorization_pending".equals(errorCode)) {
            return new JSONObject().put("status", "pending");
        }
        if ("slow_down".equals(errorCode)) {
            pendingPollIntervalSeconds += 5;
            savePendingLoginState();
            return new JSONObject().put("status", "slow_down");
        }

        clearPendingLogin();
        JSONObject failed = new JSONObject();
        failed.put("status", "failed");
        failed.put("code", errorCode);
        failed.put(
            "message",
            payload.optString(
                "error_description",
                "Microsoft 로그인에 실패했습니다."
            )
        );
        return failed;
    }

    private long versionScore(String value) {
        if (value == null) return -1;
        Matcher matcher = VERSION_PATTERN.matcher(value);
        if (!matcher.find()) return -1;
        long major = Long.parseLong(matcher.group(1));
        long minor = Long.parseLong(matcher.group(2));
        long patch = Long.parseLong(matcher.group(3));
        return major * 1000000L + minor * 1000L + patch;
    }

    private String currentVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            return "0.0.0";
        }
    }


    private String sha256Hex(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte value : digest) hex.append(String.format("%02x", value & 0xff));
        return hex.toString();
    }

    private void verifyUpdateDigest(byte[] bytes, String expectedDigest) throws Exception {
        String expected = expectedDigest == null ? "" : expectedDigest.trim();
        if (!expected.toLowerCase(java.util.Locale.ROOT).startsWith("sha256:")) {
            throw new CloudException("UPDATE_INTEGRITY", "업데이트 검증값이 없습니다.");
        }
        String actual = "sha256:" + sha256Hex(bytes);
        if (!actual.equalsIgnoreCase(expected)) {
            throw new CloudException("UPDATE_INTEGRITY", "업데이트 파일 검증에 실패했습니다.");
        }
    }

    private byte[] downloadBytes(String address) throws Exception {
        if (!UpdateSecurity.isTrustedReleaseAsset(address)) {
            throw new CloudException("UNTRUSTED_UPDATE", "허용되지 않은 업데이트 주소입니다.");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("User-Agent", "BulletBook-Updater");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(180000);
        connection.setInstanceFollowRedirects(true);
        int status = connection.getResponseCode();
        long contentLength = connection.getContentLengthLong();
        if (contentLength > MAX_UPDATE_BYTES) {
            connection.disconnect();
            throw new CloudException("UPDATE_TOO_LARGE", "업데이트 파일이 너무 큽니다.");
        }
        InputStream stream = status >= 400
            ? connection.getErrorStream()
            : connection.getInputStream();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (stream != null) {
            byte[] buffer = new byte[16384];
            int count;
            int total = 0;
            while ((count = stream.read(buffer)) != -1) {
                total += count;
                if (total > MAX_UPDATE_BYTES) {
                    stream.close();
                    connection.disconnect();
                    throw new CloudException("UPDATE_TOO_LARGE", "업데이트 파일이 너무 큽니다.");
                }
                output.write(buffer, 0, count);
            }
            stream.close();
        }
        connection.disconnect();
        if (status < 200 || status >= 300) {
            throw new CloudException("GITHUB_ERROR", "업데이트 파일을 내려받지 못했습니다.");
        }
        return output.toByteArray();
    }

    // GitHub 최신 릴리스의 asset 중에서 .apk 한 개를 고른다.
    private JSONObject findLatestUpdate() throws Exception {
        HttpURLConnection connection =
            (HttpURLConnection) new URL(GITHUB_RELEASES_LATEST).openConnection();
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "BulletBook-Updater");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        int status = connection.getResponseCode();
        String body = "";
        if (status < 400) {
            body = readStream(connection.getInputStream());
        }
        connection.disconnect();

        JSONObject summary = new JSONObject();
        String current = currentVersionName();
        summary.put("currentVersion", current);
        if (status == 404) {
            summary.put("available", false);
            summary.put("reason", "NO_RELEASE");
            return summary;
        }
        if (status < 200 || status >= 300) {
            throw new CloudException(
                "GITHUB_ERROR",
                "GitHub에서 업데이트를 확인하지 못했습니다."
            );
        }

        JSONObject release = new JSONObject(body);
        String latestVersion = "";
        Matcher tagMatch = VERSION_PATTERN.matcher(release.optString("tag_name", ""));
        if (tagMatch.find()) latestVersion = tagMatch.group();

        org.json.JSONArray assets = release.optJSONArray("assets");
        JSONObject best = null;
        long bestScore = -1;
        for (int index = 0; assets != null && index < assets.length(); index += 1) {
            JSONObject asset = assets.optJSONObject(index);
            if (asset == null) continue;
            String name = asset.optString("name", "");
            if (!name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk")) continue;
            long score = versionScore(name);
            if (score > bestScore) {
                bestScore = score;
                best = asset;
            }
        }
        if (best == null) {
            summary.put("available", false);
            summary.put("reason", "NO_APK");
            return summary;
        }
        if (latestVersion.isEmpty()) latestVersion = best.optString("name", "");
        summary.put("latestVersion", latestVersion);
        summary.put("itemId", best.optString("browser_download_url", ""));
        summary.put("digest", best.optString("digest", ""));
        summary.put("name", best.optString("name", ""));
        summary.put("size", best.optLong("size", 0));
        summary.put("available", bestScore > versionScore(current));
        return summary;
    }

    private final class CloudAccountBridge {
        @JavascriptInterface
        public int getWindowWidthDp() {
            int configuredWidth = getResources().getConfiguration().screenWidthDp;
            float density = getResources().getDisplayMetrics().density;
            int measuredWidth = density > 0
                ? Math.round(getResources().getDisplayMetrics().widthPixels / density)
                : 0;
            // screenWidthDp는 Fold의 현재 앱 창(커버/내부 화면)을 반영한다.
            // 두 값을 Math.max로 합치면 이전의 넓은 화면값 때문에 접은 뒤에도
            // 2쪽 보기로 남을 수 있으므로 현재 구성값을 우선한다.
            return configuredWidth > 0 ? configuredWidth : measuredWidth;
        }

        @JavascriptInterface
        public void cloudAuthStatus(String requestId) {
            cloudExecutor.execute(() -> {
                try {
                    JSONObject value = new JSONObject();
                    value.put(
                        "connected",
                        !readStoredToken(REFRESH_TOKEN).isEmpty()
                    );
                    value.put("accountLabel", preferences().getString(ACCOUNT_LABEL, ""));
                    sendJson(requestId, value);
                } catch (Exception error) {
                    sendError(requestId, "STATUS_ERROR", error.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void startCloudLogin(String requestId) {
            cloudExecutor.execute(() -> {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", CLIENT_ID);
                    form.put("scope", GRAPH_SCOPE);
                    HttpResult result = postForm(AUTHORITY + "/devicecode", form);
                    JSONObject payload = result.body.isEmpty()
                        ? new JSONObject()
                        : new JSONObject(result.body);
                    if (result.status < 200 || result.status >= 300 ||
                        payload.optString("device_code", "").isEmpty()) {
                        sendError(
                            requestId,
                            payload.optString("error", "LOGIN_START_FAILED"),
                            payload.optString(
                                "error_description",
                                "Microsoft 로그인을 시작하지 못했습니다. Entra의 공용 클라이언트 설정을 확인해 주세요."
                            )
                        );
                        return;
                    }

                    pendingDeviceCode = payload.getString("device_code");
                    long expiresIn = payload.optLong("expires_in", 900);
                    pendingLoginExpiresAt = System.currentTimeMillis() + expiresIn * 1000L;
                    pendingPollIntervalSeconds = Math.max(2, payload.optInt("interval", 5));
                    pendingNextPollAt = 0;
                    savePendingLoginState();

                    String verificationUri = payload.optString(
                        "verification_uri",
                        payload.optString("verification_url", "https://microsoft.com/devicelogin")
                    );
                    String verificationUriComplete =
                        payload.optString("verification_uri_complete", "");
                    String userCode = payload.optString("user_code", "");
                    String browserUri = verificationUriComplete.isEmpty()
                        ? verificationUri
                        : verificationUriComplete;
                    JSONObject challenge = new JSONObject();
                    challenge.put("userCode", userCode);
                    challenge.put("verificationUri", verificationUri);
                    challenge.put("verificationUriComplete", verificationUriComplete);
                    challenge.put("message", payload.optString("message", ""));
                    challenge.put("expiresIn", expiresIn);
                    challenge.put("interval", pendingPollIntervalSeconds);
                    sendJson(requestId, challenge);
                    scheduleAutomaticLoginPoll(
                        pendingPollIntervalSeconds * 1000L
                    );

                    runOnUiThread(() -> {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(browserUri)));
                        } catch (Exception ignored) {
                            // 로그인 코드는 WebView에도 표시되므로 브라우저를 직접 열 수 있다.
                        }
                    });
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "Microsoft 로그인 서버에 연결할 수 없습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void pollCloudLogin(String requestId) {
            cloudExecutor.execute(() -> {
                try {
                    sendJson(requestId, pollPendingLoginOnce());
                } catch (CloudException error) {
                    sendError(requestId, error.code, error.getMessage());
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "Microsoft 로그인 상태를 확인하지 못했습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void cancelCloudLogin(String requestId) {
            cloudExecutor.execute(() -> {
                clearPendingLogin();
                sendResult(requestId, true, "cancelled");
            });
        }

        @JavascriptInterface
        public void readCloudBook(String requestId) {
            cloudExecutor.execute(() -> {
                try {
                    sendResult(requestId, true, MainActivity.this.readCloudBook());
                } catch (CloudException error) {
                    sendError(requestId, error.code, error.getMessage());
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "OneDrive의 불렛북을 읽지 못했습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void writeCloudBook(String requestId, String content) {
            cloudExecutor.execute(() -> {
                try {
                    MainActivity.this.writeCloudBook(content);
                    sendResult(requestId, true, "saved");
                } catch (CloudException error) {
                    sendError(requestId, error.code, error.getMessage());
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "OneDrive에 불렛북을 저장하지 못했습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void checkAppUpdate(String requestId) {
            cloudExecutor.execute(() -> {
                try {
                    sendJson(requestId, findLatestUpdate());
                } catch (CloudException error) {
                    sendError(requestId, error.code, error.getMessage());
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "업데이트를 확인하지 못했습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void installAppUpdate(String requestId, String itemId) {
            cloudExecutor.execute(() -> {
                try {
                    if (itemId == null || itemId.isEmpty()) {
                        sendError(requestId, "NO_ITEM", "설치할 업데이트 파일이 없습니다.");
                        return;
                    }
                    JSONObject trustedUpdate = findLatestUpdate();
                    String trustedItemId = trustedUpdate.optString("itemId", "");
                    if (!itemId.equals(trustedItemId) || !UpdateSecurity.isTrustedReleaseAsset(trustedItemId)) {
                        throw new CloudException(
                            "UNTRUSTED_UPDATE",
                            "GitHub 최신 릴리스와 일치하지 않는 업데이트입니다."
                        );
                    }
                    // Android 8부터는 '이 출처의 앱 설치 허용'을 켜야 설치할 수 있다.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                        !getPackageManager().canRequestPackageInstalls()) {
                        runOnUiThread(() -> {
                            try {
                                Intent settings = new Intent(
                                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName())
                                );
                                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(settings);
                            } catch (Exception ignored) {
                                // 설정 화면을 못 열면 아래 안내 문구만 표시된다.
                            }
                        });
                        sendError(
                            requestId,
                            "INSTALL_PERMISSION",
                            "이 앱에서 앱 설치를 허용해 주세요. 설정 화면을 열었습니다. 허용한 뒤 다시 눌러 주세요."
                        );
                        return;
                    }

                    byte[] bytes = downloadBytes(trustedItemId);
                    verifyUpdateDigest(bytes, trustedUpdate.optString("digest", ""));

                    File target = new File(getCacheDir(), "BulletBook_update.apk");
                    try (FileOutputStream output = new FileOutputStream(target)) {
                        output.write(bytes);
                        output.flush();
                    }

                    Uri uri = FileProvider.getUriForFile(
                        MainActivity.this,
                        getPackageName() + ".fileprovider",
                        target
                    );
                    runOnUiThread(() -> {
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(uri, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(install);
                    });
                    sendResult(requestId, true, "installing");
                } catch (CloudException error) {
                    sendError(requestId, error.code, error.getMessage());
                } catch (Exception error) {
                    sendError(
                        requestId,
                        "NETWORK_ERROR",
                        "업데이트를 설치하지 못했습니다: " + error.getMessage()
                    );
                }
            });
        }

        @JavascriptInterface
        public void disconnectCloudAccount(String requestId) {
            cloudExecutor.execute(() -> {
                clearPendingLogin();
                clearToken();
                sendResult(requestId, true, "disconnected");
            });
        }

        // 위젯 전용 일정 snapshot을 받아 SharedPreferences에 저장하고 위젯을 갱신한다.
        // .buj 구조 전체를 native가 이해하지 않도록 JS에서 요약본만 보낸다.
        @JavascriptInterface
        public void pushCalendarWidget(String requestId, String json) {
            cloudExecutor.execute(() -> {
                try {
                    preferences().edit()
                        .putString("calendar_widget_v1_json", json == null ? "" : json)
                        .apply();
                    runOnUiThread(() ->
                        CalendarWidgetProvider.refreshWidgets(MainActivity.this));
                    sendResult(requestId, true, "ok");
                } catch (Exception error) {
                    sendError(requestId, "WIDGET_SYNC_ERROR", error.getMessage());
                }
            });
        }

        // WebView(app.js)가 초기화를 마친 뒤 보관된 위젯 딥링크를 전달해 달라고 알린다.
        @JavascriptInterface
        public void readyForWidgetNavigation(String requestId) {
            runOnUiThread(() -> {
                dispatchWidgetNavigation();
                sendResult(requestId, true, "ok");
            });
        }
    }
}
