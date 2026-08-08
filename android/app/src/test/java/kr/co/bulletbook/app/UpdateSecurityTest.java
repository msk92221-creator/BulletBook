package kr.co.bulletbook.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateSecurityTest {
    @Test
    public void widgetValuesAreStrictAndCanonical() {
        assertEquals("2026-08-08", UpdateSecurity.canonicalWidgetDate("2026-08-08"));
        assertEquals("2026-08", UpdateSecurity.canonicalWidgetMonth("2026-08"));
        assertNull(UpdateSecurity.canonicalWidgetDate("2026-02-30"));
        assertNull(UpdateSecurity.canonicalWidgetMonth("2026-13"));
        assertNull(UpdateSecurity.canonicalWidgetDate("2026-08-08');alert(1);//"));
    }

    @Test
    public void onlyOfficialGitHubReleaseAssetsAreTrusted() {
        assertTrue(UpdateSecurity.isTrustedReleaseAsset(
            "https://github.com/msk92221-creator/BulletBook/releases/download/v0.39.1/BulletBook_v0.39.1.apk"
        ));
        assertFalse(UpdateSecurity.isTrustedReleaseAsset(
            "http://github.com/msk92221-creator/BulletBook/releases/download/v0.39.1/app.apk"
        ));
        assertFalse(UpdateSecurity.isTrustedReleaseAsset(
            "https://github.com/another/BulletBook/releases/download/v0.39.1/app.apk"
        ));
        assertFalse(UpdateSecurity.isTrustedReleaseAsset("https://example.invalid/app.apk"));
    }
}