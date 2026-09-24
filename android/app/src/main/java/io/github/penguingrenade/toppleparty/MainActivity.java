package io.github.penguingrenade.toppleparty;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Topple Party for Android TV: a full-screen WebView that hosts the game page.
 * Phones join by scanning the QR code the page shows; they talk to this WebView over WebRTC.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "topple";
    private static final String KEY_URL = "gameUrl";

    private WebView web;
    private boolean offline;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        goImmersive();

        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(0xFF1A1440);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " TopplePartyTV/1");

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline(String.valueOf(error.getDescription()));
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.equals(currentUrl())) showOffline(description);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                // e.g. a 404 because GitHub Pages isn't set up yet, or a mistyped URL
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showOffline("HTTP " + response.getStatusCode() + " from " + currentUrl());
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "TopplePartyApp");
        setContentView(web);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        web.requestFocus();
        loadGame();
    }

    private String currentUrl() {
        SharedPreferences p = getSharedPreferences(PREFS, 0);
        String u = p.getString(KEY_URL, null);
        return (u == null || u.length() == 0) ? Config.GAME_URL : u;
    }

    private void loadGame() {
        offline = false;
        web.loadUrl(currentUrl());
    }

    private void showOffline(String reason) {
        if (offline) return;
        offline = true;
        String url = currentUrl();
        String html = "<!doctype html><html><head><meta name=viewport content='width=device-width'>"
                + "<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;"
                + "background:#1a1440;color:#fff;font-family:sans-serif;text-align:center}"
                + "h1{font-size:48px;margin:0 0 8px}p{opacity:.8;font-size:20px}"
                + "input{width:640px;font-size:22px;padding:10px;border-radius:10px;border:3px solid #fff3;background:#0006;color:#fff}"
                + "button{font-size:24px;margin:14px 8px;padding:12px 28px;border-radius:40px;border:0;background:#ffcc33;color:#222;font-weight:bold}"
                + "button:focus,input:focus{outline:5px solid #6cf}</style></head><body><div>"
                + "<h1>Can't reach the game</h1><p>Check the TV's internet connection.</p><p style='font-size:14px'>" + esc(reason) + "</p>"
                + "<p><input id=u value='" + esc(url) + "'></p>"
                + "<button id=r autofocus onclick='TopplePartyApp.retry()'>Retry</button>"
                + "<button onclick='TopplePartyApp.setUrl(document.getElementById(\"u\").value)'>Save URL</button>"
                + "<button onclick='TopplePartyApp.resetUrl()'>Reset URL</button>"
                + "<button onclick='TopplePartyApp.exit()'>Exit</button>"
                + "<script>document.getElementById('r').focus();</script>"
                + "</div></body></html>";
        web.loadDataWithBaseURL("about:blank", html, "text/html", "utf-8", null);
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace("'", "&#39;").replace("\"", "&quot;");
    }

    private void goImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (offline) {
            finish();
            return;
        }
        // Let the game decide: it returns true if it handled Back (closed a menu, paused, etc.).
        web.evaluateJavascript("(window.__tvBack && window.__tvBack()) ? 'y' : 'n'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("y")) finish();
            }
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        goImmersive();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /** Methods the web page can call as window.TopplePartyApp.*. */
    final class Bridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    finish();
                }
            });
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    loadGame();
                }
            });
        }

        @JavascriptInterface
        public void setUrl(final String url) {
            String u = url == null ? "" : url.trim();
            if (u.length() > 0 && !u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
            getSharedPreferences(PREFS, 0).edit().putString(KEY_URL, u).apply();
            retry();
        }

        @JavascriptInterface
        public void resetUrl() {
            getSharedPreferences(PREFS, 0).edit().remove(KEY_URL).apply();
            retry();
        }

        @JavascriptInterface
        public String getUrl() {
            return currentUrl();
        }
    }
}
